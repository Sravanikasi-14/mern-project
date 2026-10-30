import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { useAuth } from "../app/AuthContext";
import { useNotify } from "../app/notifyContext";
import { companyHasLogo, getCompanyBrandName } from "../utils/companyBrand";
import { loadCompanyLogoObjectUrl } from "../utils/companyLogo";
import ProfileAvatar from "./ProfileAvatar";

/**
 * Stitch HR portal top chrome: brand mark + eyebrow + title + notify + avatar.
 */
export default function HrPortalHeader({
  title = "Dashboard",
  eyebrow = "HR Admin Portal",
  showAvatar = true,
}) {
  const { user, company } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const brand = getCompanyBrandName(company);
  const hasLogo = companyHasLogo(company);
  const [logoSrc, setLogoSrc] = useState("");
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!hasLogo) {
      setLogoSrc("");
      setLogoFailed(false);
      return undefined;
    }
    (async () => {
      try {
        const url = await loadCompanyLogoObjectUrl(company?.branding?.logoUrl || "logo");
        if (!cancelled) {
          setLogoSrc(url);
          setLogoFailed(false);
        }
      } catch {
        if (!cancelled) {
          setLogoSrc("");
          setLogoFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasLogo, company?.branding?.logoUrl]);

  const showImage = hasLogo && logoSrc && !logoFailed;

  return (
    <header className="hr-portal-header">
      <div className="hr-portal-brand">
        {showImage ? (
          <img
            src={logoSrc}
            alt=""
            className="hr-portal-logo"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <span className="hr-portal-mark" aria-hidden="true">
            {brand.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="hr-portal-titles">
          <span className="hr-portal-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="hr-portal-actions">
        <button type="button" className="icon-btn" onClick={() => notify()} aria-label="Notifications">
          <Bell size={22} strokeWidth={1.85} aria-hidden="true" />
        </button>
        {showAvatar ? (
          <button
            type="button"
            className="hr-portal-avatar-btn"
            aria-label="Account"
            onClick={() => navigate("/admin/settings")}
          >
            <ProfileAvatar
              name={user?.name || user?.fullName || user?.email || "HR"}
              photo={user?.avatar}
              size={36}
              className="hr-portal-avatar"
            />
          </button>
        ) : null}
      </div>
    </header>
  );
}
