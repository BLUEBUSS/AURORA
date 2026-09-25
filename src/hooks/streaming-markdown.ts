// Adapted from ANLYST/OpenClaw MarkdownRenderer's debounce + maxWait (MIT).
import { useEffect, useRef, useState } from "react";
export function useStreamingMarkdown(content: string, streaming: boolean) {
  const [visible, setVisible] = useState(content);
  const lastFire = useRef(Date.now());
  useEffect(() => {
    if (!streaming) {
      setVisible(content);
      lastFire.current = Date.now();
      return;
    }
    const elapsed = Date.now() - lastFire.current;
    if (elapsed >= 400) {
      setVisible(content);
      lastFire.current = Date.now();
      return;
    }
    const timer = setTimeout(
      () => {
        setVisible(content);
        lastFire.current = Date.now();
      },
      Math.min(100, 400 - elapsed),
    );
    return () => clearTimeout(timer);
  }, [content, streaming]);
  return streaming ? visible : content;
}
