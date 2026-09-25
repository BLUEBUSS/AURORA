export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`aurora-wordmark ${className}`} aria-label="AURORA">
      <span aria-hidden="true">AURORA</span>
    </span>
  );
}
