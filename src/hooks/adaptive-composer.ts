import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Measure the compact width separately so expanding the field cannot cause a wrap/shrink loop. */
export function useAdaptiveComposer(value: string, sessionKey: string, hasAttachments: boolean) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const resize = useCallback(() => {
    const form = formRef.current,
      field = textareaRef.current,
      options = optionsRef.current;
    if (!form || !field || !options) return;
    const formStyle = getComputedStyle(form),
      textStyle = getComputedStyle(field);
    const padding = parseFloat(formStyle.paddingLeft) + parseFloat(formStyle.paddingRight);
    const gap = parseFloat(formStyle.columnGap) || 8;
    const attachmentWidth =
      form.querySelector(".composer-attachment")?.getBoundingClientRect().width || 32;
    const sendWidth = form.querySelector(".send-button")?.getBoundingClientRect().width || 36;
    const compactWidth =
      form.clientWidth -
      padding -
      attachmentWidth -
      sendWidth -
      options.getBoundingClientRect().width -
      gap * 3;
    canvasRef.current ??= document.createElement("canvas");
    const context = canvasRef.current.getContext("2d");
    if (context) context.font = textStyle.font;
    const textWidth =
      context?.measureText(value).width ?? value.length * parseFloat(textStyle.fontSize);
    const needsExpansion =
      hasAttachments ||
      form.clientWidth < 620 ||
      value.includes("\n") ||
      textWidth > Math.max(1, compactWidth - 12);
    if (needsExpansion !== expanded) {
      setExpanded(needsExpansion);
      return;
    }
    const maximum = Math.min(180, window.innerHeight * 0.25);
    field.style.height = "0px";
    const naturalHeight = field.scrollHeight;
    field.style.height = `${Math.min(maximum, naturalHeight)}px`;
    field.style.overflowY = naturalHeight > maximum ? "auto" : "hidden";
  }, [value, expanded, hasAttachments]);
  const resizeRef = useRef(resize);
  resizeRef.current = resize;
  useLayoutEffect(() => resize(), [resize, sessionKey]);
  useEffect(() => {
    let widthSignature = "";
    let frame = 0;
    const observer = new ResizeObserver(() => {
      const signature = `${formRef.current?.clientWidth}:${optionsRef.current?.getBoundingClientRect().width}`;
      if (signature !== widthSignature) {
        widthSignature = signature;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => resizeRef.current());
      }
    });
    if (formRef.current) observer.observe(formRef.current);
    if (optionsRef.current) observer.observe(optionsRef.current);
    const onViewport = () => resizeRef.current();
    window.addEventListener("resize", onViewport);
    let disposed = false;
    void document.fonts?.ready.then(() => {
      if (!disposed) resizeRef.current();
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", onViewport);
    };
  }, []);
  return { formRef, textareaRef, optionsRef, expanded };
}
