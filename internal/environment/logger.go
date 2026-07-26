package environment

import (
	"bufio"
	"fmt"
	"io"
	"io/fs"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	currentDate string
	logMutex    sync.Mutex

	logFileWriter *bufferedFileWriter
)

const (
	// Large enough that a burst of log lines costs one write syscall rather
	// than one per line.
	logBufferSize = 32 * 1024

	// How long a log line may sit in the buffer before reaching disk. Short
	// enough that a crash loses at most this much, long enough that a busy
	// server is not doing a syscall per line.
	logFlushInterval = time.Second
)

// Buffers writes to the log file so that a busy server is not issuing a write
// syscall for every log line. bufio.Writer is not safe for concurrent use and
// the flush loop runs alongside the loggers, so access is serialised here.
//
// Only the file is buffered. os.Stdout is left unbuffered so container log
// collectors still see output immediately.
type bufferedFileWriter struct {
	mutex  sync.Mutex
	buffer *bufio.Writer
	file   *os.File
}

func newBufferedFileWriter(file *os.File) *bufferedFileWriter {
	return &bufferedFileWriter{
		buffer: bufio.NewWriterSize(file, logBufferSize),
		file:   file,
	}
}

func (w *bufferedFileWriter) Write(p []byte) (int, error) {
	w.mutex.Lock()
	defer w.mutex.Unlock()

	return w.buffer.Write(p)
}

func (w *bufferedFileWriter) Flush() {
	w.mutex.Lock()
	defer w.mutex.Unlock()

	if err := w.buffer.Flush(); err != nil {
		fmt.Fprintf(os.Stderr, "failed flushing log buffer: %v\n", err)
	}
}

// Flushes anything still buffered and closes the underlying file. Used when
// rotating to a new day's file so the old one is not left truncated.
func (w *bufferedFileWriter) Close() {
	w.Flush()

	w.mutex.Lock()
	defer w.mutex.Unlock()

	if err := w.file.Close(); err != nil {
		fmt.Fprintf(os.Stderr, "failed closing log file: %v\n", err)
	}
}

// FlushLogs writes any buffered log output to disk immediately. Anything that
// reads the log file back, or is about to terminate the process, should call
// this first.
func FlushLogs() {
	logMutex.Lock()
	writer := logFileWriter
	logMutex.Unlock()

	if writer != nil {
		writer.Flush()
	}
}

func SetupLogger() {
	slog.SetLogLoggerLevel(parseLogLevel())

	if strings.EqualFold(os.Getenv(loggingEnabled), "false") {
		return
	}

	setupLoggerForDate(time.Now().Format("20060102"))
	startLogRotation()
}

func parseLogLevel() slog.Level {
	switch strings.ToUpper(os.Getenv(loggingLevel)) {
	case "DEBUG":
		return slog.LevelDebug
	case "WARN":
		return slog.LevelWarn
	case "ERROR":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func setupLoggerForDate(date string) {
	logFile, err := getLogFileWriter()
	if err != nil {
		slog.Error("Failed to open log file", "err", err)
		return
	}

	previous := logFileWriter
	logFileWriter = newBufferedFileWriter(logFile)

	log.SetOutput(io.MultiWriter(os.Stdout, logFileWriter))
	currentDate = date

	// Only after the new writer is installed, so no line is written to a
	// closed file.
	if previous != nil {
		previous.Close()
	}
}

func startLogRotation() {
	go func() {
		ticker := time.NewTicker(logFlushInterval)
		defer ticker.Stop()

		lastRotationCheck := time.Now()

		for range ticker.C {
			logMutex.Lock()

			// The date only needs checking occasionally; flushing is what the
			// fast tick is for.
			if time.Since(lastRotationCheck) >= time.Minute {
				lastRotationCheck = time.Now()

				if now := time.Now().Format("20060102"); now != currentDate {
					setupLoggerForDate(now)
				}
			}

			writer := logFileWriter
			logMutex.Unlock()

			if writer != nil {
				writer.Flush()
			}
		}
	}()
}

func GetLogFileReader() (logFile *os.File, err error) {
	// The admin log view reads the file straight off disk, so anything still
	// sitting in the write buffer has to be pushed out first or the most
	// recent lines would be missing.
	FlushLogs()

	logDir, _, _ := getLogfilePath()
	logFilePath, err := getLatestLogFile(logDir)
	if err != nil {
		slog.Error("Logger Error", "err", err)
	}

	file, err := os.Open(logFilePath)
	if err != nil {
		slog.Error("Logger Error", "err", err)
	}

	return file, err
}

func getLogFileWriter() (logFile *os.File, err error) {
	logDir, _, logFilePath := getLogfilePath()

	if err := os.MkdirAll(logDir, os.ModePerm); err != nil {
		slog.Error("Failed to create log directory", "err", err)
		os.Exit(1)
	}

	if envLogTruncateExistingFile := strings.EqualFold(os.Getenv(loggingNewFileOnStartup), "true"); envLogTruncateExistingFile {
		logFile, err = os.OpenFile(logFilePath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0666)
	} else {
		logFile, err = os.OpenFile(logFilePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	}

	if err != nil {
		slog.Error("Logger Error", "filePath", logFilePath, "err", err)
		os.Exit(1)
	}

	return logFile, nil
}

func getLogfilePath() (directory string, fileName string, logFilePath string) {
	logDir := "logs"
	if envLogDir := os.Getenv(loggingDirectory); envLogDir != "" {
		logDir = envLogDir
	}

	logFileName := time.Now().Format("20060102")

	if envLogFileIsSingleFile := strings.EqualFold(os.Getenv(loggingSingleFile), "true"); envLogFileIsSingleFile {
		logFileName = "log"
	}

	return logDir, logFileName, logDir + "/" + logFileName
}

func getLatestLogFile(logDir string) (string, error) {
	var dates []time.Time
	var fileMap = make(map[time.Time]string)

	err := filepath.WalkDir(logDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || strings.Contains(d.Name(), ".") {
			return nil
		}

		t, err := time.Parse("20060102", d.Name())
		if err != nil {
			return nil
		}

		dates = append(dates, t)
		fileMap[t] = path
		return nil
	})

	if err != nil {
		return "", err
	}

	if len(dates) == 0 {
		return "", fmt.Errorf("no log files found")
	}

	sort.Slice(dates, func(i, j int) bool {
		return dates[i].After(dates[j])
	})

	latest := dates[0]
	return fileMap[latest], nil
}
