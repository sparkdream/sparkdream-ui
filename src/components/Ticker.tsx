const ITEMS = [
  <>Block <b>1,284,509</b></>,
  <>Season 3 · <b className="hot">OPEN</b></>,
  <>14 posts in last 24h</>,
  <>Proposal #17 · mint curve · <b className="hot">VOTING</b></>,
  <>Naming dispute #3 · resolved</>,
  <>12 active session keys</>,
  <>Futarchy market: treasury allocation · $2,840 TVL</>,
  <>Reveal round closes in <b className="hot">3h 42m</b></>,
  <>Federation · 4 peer chains online</>,
];

export default function Ticker() {
  return (
    <div className="sd-ticker" aria-label="On-chain ticker">
      <div className="sd-ticker-track">
        {ITEMS.map((item, i) => (
          <span key={`a${i}`}>{item}</span>
        ))}
        {ITEMS.map((item, i) => (
          <span key={`b${i}`} aria-hidden="true">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
