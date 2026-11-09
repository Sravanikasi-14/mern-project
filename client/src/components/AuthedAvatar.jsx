import useAuthedImage from "../hooks/useAuthedImage";

/**
 * Circular photo (loaded through the authenticated API client) with an initials fallback.
 * Renders the same markup/classes as before when there is no photo.
 */
export default function AuthedAvatar({
  src,
  initials,
  alt = "",
  className = "",
  style,
  imgClassName = "",
}) {
  const { url } = useAuthedImage(src);

  return (
    <span className={className} style={style}>
      {url ? (
        <img
          className={imgClassName}
          src={url}
          alt={alt}
          style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%", display: "block" }}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
}
