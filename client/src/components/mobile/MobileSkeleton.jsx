export default function MobileSkeleton({ rows = 3 }) {
  return (
    <div className="m-skel-list" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="m-skel m-skel-row" />
      ))}
    </div>
  );
}
