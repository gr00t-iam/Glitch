export interface TokenVelocityProps {
  rate: number;
  unit?: string;
}

export function TokenVelocity({ rate, unit = "t/s" }: TokenVelocityProps) {
  return (
    <div className="token-velocity-badge" role="status" aria-live="polite" tabIndex={0}>
      <span>Token Velocity</span>
      <strong>{rate} {unit}</strong>
    </div>
  );
}
