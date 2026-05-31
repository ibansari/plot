export default function Home() {
  return (
    <div className="wrap">
      <div className="eyebrow"><span className="mark">✦</span> Plot</div>
      <h1 className="title">Plot guest links</h1>
      <p className="sub">
        This site serves the secure vote/RSVP links Plot texts to people who don’t have the app.
        Open the link from your SMS (or the one printed in the API logs by the mock SMS sender).
      </p>
      <p className="foot">Try: <code>/v/&lt;token&gt;?s=&lt;signature&gt;</code></p>
    </div>
  );
}
