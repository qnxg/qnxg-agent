/**
 * 顶栏：标题、模型名、新对话按钮、主题切换
 */
import { useEffect, useState } from "react";
import { Monitor, Moon, Plus, Sun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/theme-provider";
import { fetchInfo } from "@/api";

export function Header({ onNewChat }: { onNewChat: () => void }) {
  const { theme, setTheme } = useTheme();
  const [model, setModel] = useState<string>();

  useEffect(() => {
    fetchInfo()
      .then((info) => setModel(info.model))
      .catch(() => {});
  }, []);

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
      <h1 className="text-base font-semibold">微湖大 Agent</h1>
      {model && <Badge variant="secondary">{model}</Badge>}

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={onNewChat} title="新对话">
          <Plus className="size-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" title="主题" />}
          >
            {theme === "dark" ? (
              <Moon className="size-4" />
            ) : theme === "light" ? (
              <Sun className="size-4" />
            ) : (
              <Monitor className="size-4" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTheme("light")}>
              <Sun className="size-4" /> 浅色
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              <Moon className="size-4" /> 深色
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              <Monitor className="size-4" /> 跟随系统
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
