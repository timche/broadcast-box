import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LoggingPage } from "@/components/admin/logging-page";
import { ProfilesPage } from "@/components/admin/profiles-page";
import { StatusPage } from "@/components/admin/status-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { clearAdminToken, getAdminToken, setAdminToken } from "@/lib/admin-auth";
import { verifyAdminToken } from "@/lib/queries/admin";

type Menu = "Status" | "Profiles" | "Logging";
const MENUS: Menu[] = ["Status", "Profiles", "Logging"];

export function AdminConsole() {
  const navigate = useNavigate();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [menu, setMenu] = useState<Menu>("Status");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const existing = getAdminToken();
    if (existing === null) {
      return;
    }
    verifyAdminToken(existing)
      .then((response) => {
        if (response.isValid) {
          setIsLoggedIn(true);
        }
      })
      .catch(() => clearAdminToken());
  }, []);

  const login = () => {
    verifyAdminToken(token)
      .then((response) => {
        if (response.isValid) {
          setAdminToken(token);
          setIsLoggedIn(true);
          setError("");
        } else {
          clearAdminToken();
          setError(response.errorMessage || "Invalid login");
        }
      })
      .catch(() => setError("Invalid login"));
  };

  const logout = () => {
    clearAdminToken();
    void navigate({ to: "/" });
  };

  if (!isLoggedIn) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-4 pt-16">
        <h1 className="text-2xl font-light">Admin login</h1>
        <Input
          type="password"
          autoFocus
          placeholder="Admin token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          onKeyUp={(event) => {
            if (event.key === "Enter") {
              login();
            }
          }}
        />
        {error !== "" && <p className="text-destructive text-sm">{error}</p>}
        <Button onClick={login}>Log in</Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto flex flex-col gap-4 py-4">
      <h1 className="text-3xl font-light">Admin</h1>
      <div className="flex flex-col gap-4 md:flex-row">
        <Card className="py-4 md:w-56">
          <CardContent className="flex flex-col gap-2 px-4">
            {MENUS.map((item) => (
              <Button
                key={item}
                variant={menu === item ? "default" : "ghost"}
                className="justify-start"
                onClick={() => setMenu(item)}
              >
                {item}
              </Button>
            ))}
            <Button variant="ghost" className="justify-start" onClick={logout}>
              Logout
            </Button>
          </CardContent>
        </Card>

        <Card className="flex-1">
          <CardContent>
            {menu === "Status" && <StatusPage />}
            {menu === "Profiles" && <ProfilesPage />}
            {menu === "Logging" && <LoggingPage />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
