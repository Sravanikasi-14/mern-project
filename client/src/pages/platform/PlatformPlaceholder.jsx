export default function PlatformPlaceholder({ title, description }) {
  return (
    <div className="pa-placeholder">
      <h1 className="pa-page-title">{title}</h1>
      <p className="pa-page-sub">{description}</p>
      <div className="pa-panel">
        <h2>Coming in a later batch</h2>
        <p className="pa-muted">
          This navigation module is reserved. No configuration or data mutations are available here
          yet.
        </p>
      </div>
    </div>
  );
}
