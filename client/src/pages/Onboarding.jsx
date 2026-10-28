import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";

export default function Onboarding() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();
  const { applySession, setupInitialAdmin } = useAuth();

  // Token-based state
  const [verifying, setVerifying] = useState(Boolean(token));
  const [invitation, setInvitation] = useState(null);
  const [verifyError, setVerifyError] = useState("");

  // Common authentication credentials
  const [companyCode, setCompanyCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Employee self-service onboarding fields
  const [preferredName, setPreferredName] = useState("");
  const [personalEmail, setPersonalEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [personalPhone, setPersonalPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");

  const [residentialStreet, setResidentialStreet] = useState("");
  const [residentialCity, setResidentialCity] = useState("");
  const [residentialState, setResidentialState] = useState("");
  const [residentialPostalCode, setResidentialPostalCode] = useState("");

  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyRel, setEmergencyRel] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");

  const [accountHolderName, setAccountHolderName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [accountType, setAccountType] = useState("SAVINGS");
  const [panNumber, setPanNumber] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Token verification effect
  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;

    const verify = async () => {
      try {
        const response = await api.get(`/auth/onboarding/verify?token=${encodeURIComponent(token)}`);
        if (!cancelled) {
          const data = response.data;
          setInvitation(data);
          setCompanyCode(data.companyCode || "");
          setEmail(data.email || "");
          if (data.fullName) {
            setAccountHolderName(data.fullName);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setVerifyError(
            err.response?.data?.message ||
              "This onboarding invitation link is invalid or has expired."
          );
        }
      } finally {
        if (!cancelled) {
          setVerifying(false);
        }
      }
    };

    verify();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");

    if (!token) {
      if (!companyCode.trim() || !email.trim() || !password) {
        setFormError("Please enter your company code, email, and password.");
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        setFormError("Please enter a valid email address.");
        return;
      }
    }

    if (password.length < 8) {
      setFormError("Password must be at least 8 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setFormError("Passwords do not match. Please verify and try again.");
      return;
    }

    setSubmitting(true);

    try {
      if (token) {
        if (invitation?.type === "EMPLOYEE") {
          // Employee self-service onboarding payload
          const payload = {
            token,
            password,
            preferredName: preferredName.trim() || undefined,
            personalEmail: personalEmail.trim() || undefined,
            phoneNumber: phoneNumber.trim() || undefined,
            personalPhone: personalPhone.trim() || undefined,
            dateOfBirth: dateOfBirth || undefined,
            gender: gender || undefined,
            residentialAddress: {
              street: residentialStreet.trim() || undefined,
              city: residentialCity.trim() || undefined,
              state: residentialState.trim() || undefined,
              postalCode: residentialPostalCode.trim() || undefined,
              country: "India",
            },
            emergencyContact: {
              name: emergencyName.trim() || undefined,
              relationship: emergencyRel.trim() || undefined,
              phone: emergencyPhone.trim() || undefined,
            },
            bankDetails: {
              accountHolderName: accountHolderName.trim() || invitation.fullName,
              bankName: bankName.trim() || undefined,
              accountNumber: accountNumber.trim() || undefined,
              ifscCode: ifscCode.trim() || undefined,
              accountType,
            },
            taxDetails: {
              panNumber: panNumber.trim() || undefined,
            },
          };

          const response = await api.post("/auth/onboarding/complete", payload);
          if (applySession && response.data) {
            applySession(response.data);
          }
          navigate("/app", { replace: true });
        } else {
          // Admin / generic onboarding completion
          const response = await api.post("/auth/onboarding/complete", {
            token,
            password,
          });
          if (applySession && response.data) {
            applySession(response.data);
          }
          navigate("/admin", { replace: true });
        }
      } else {
        // Initial admin workspace creation
        await setupInitialAdmin({
          companyCode: companyCode.trim().toLowerCase(),
          email: email.trim(),
          password,
          confirmPassword,
        });
        navigate("/admin", { replace: true });
      }
    } catch (err) {
      if (!err.response || err.code === "ERR_NETWORK" || err.response.status >= 500) {
        setFormError("We're unable to connect right now. Please try again in a moment.");
      } else {
        setFormError(
          err.response.data?.message ||
            "Unable to complete setup. Please check your details and try again."
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isEmployeeFlow = invitation?.type === "EMPLOYEE";

  return (
    <main
      className="container"
      style={{
        maxWidth: isEmployeeFlow ? "820px" : "650px",
        transition: "max-width 0.2s ease",
      }}
    >
      <h1>
        {isEmployeeFlow
          ? "Employee Onboarding"
          : "HR Admin Setup"}
      </h1>
      <p className="subtitle">
        {isEmployeeFlow
          ? `Set your password for ${invitation?.companyName || "your company"}.`
          : "Create the administrator account for your company."}
      </p>

      {verifying && <p style={{ marginTop: "16px", color: "#64748b" }}>Verifying invitation...</p>}

      {!verifying && verifyError && (
        <div style={{ marginTop: "20px" }}>
          <p role="alert" className="error" style={{ marginBottom: "16px" }}>
            {verifyError}
          </p>
          <Link to="/login" replace>
            <button type="button">Go to Sign in</button>
          </Link>
        </div>
      )}

      {!verifying && !verifyError && (
        <>
          {invitation && (
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "16px",
                marginTop: "20px",
                marginBottom: "20px",
                display: "grid",
                gridTemplateColumns: isEmployeeFlow ? "repeat(auto-fit, minmax(200px, 1fr))" : "1fr",
                gap: "12px",
                fontSize: "14px",
              }}
            >
              <div>
                <strong style={{ color: "#475569" }}>Company: </strong>
                <span>{invitation.companyName}</span>{" "}
                <code style={{ background: "#e2e8f0", padding: "1px 5px", borderRadius: "4px", fontSize: "12px" }}>
                  {invitation.companyCode}
                </code>
              </div>
              {invitation.fullName && (
                <div>
                  <strong style={{ color: "#475569" }}>Employee: </strong>
                  <span style={{ fontWeight: "600" }}>{invitation.fullName}</span>
                </div>
              )}
              {invitation.employeeCode && (
                <div>
                  <strong style={{ color: "#475569" }}>Code: </strong>
                  <span>{invitation.employeeCode}</span>
                </div>
              )}
              <div>
                <strong style={{ color: "#475569" }}>Work Email: </strong>
                <span>{invitation.email}</span>
              </div>
              {invitation.jobTitle && (
                <div>
                  <strong style={{ color: "#475569" }}>Job Title: </strong>
                  <span>{invitation.jobTitle}</span>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            {!invitation && (
              <>
                <label>
                  Company Code *
                  <input
                    value={companyCode}
                    onChange={(e) => {
                      setCompanyCode(e.target.value);
                      if (formError) setFormError("");
                    }}
                    placeholder="e.g. acme"
                    autoComplete="organization"
                    required
                  />
                </label>
                <label>
                  Email *
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (formError) setFormError("");
                    }}
                    placeholder="hr@company.com"
                    autoComplete="username"
                    required
                  />
                </label>
              </>
            )}

            {/* Section 1: Account Security (Always Required) */}
            <div style={{ marginBottom: "20px" }}>
              <h3 style={{ fontSize: "15px", color: "#0f172a", borderBottom: "1px solid #e2e8f0", paddingBottom: "8px", margin: "0 0 14px" }}>
                1. Password
              </h3>
              <div className="auth-row">
                <label>
                  Password (min 8 characters) *
                  <div className="password-input-wrapper">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (formError) setFormError("");
                      }}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowPassword((prev) => !prev)}
                      title={showPassword ? "Hide password" : "Show password"}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                      ) : (
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </label>

                <label>
                  Confirm password *
                  <div className="password-input-wrapper">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        if (formError) setFormError("");
                      }}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      title={showConfirmPassword ? "Hide password" : "Show password"}
                      aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                    >
                      {showConfirmPassword ? (
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                      ) : (
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </label>
              </div>
            </div>

            {/* Employee Self-Service Sections */}
            {isEmployeeFlow && (
              <>
                {/* Section 2: Personal Information */}
                <div style={{ marginBottom: "20px" }}>
                  <h3 style={{ fontSize: "15px", color: "#0f172a", borderBottom: "1px solid #e2e8f0", paddingBottom: "8px", margin: "0 0 14px" }}>
                    2. Personal Details
                  </h3>
                  <div className="auth-row">
                    <label>
                      Preferred Name
                      <input
                        type="text"
                        value={preferredName}
                        onChange={(e) => setPreferredName(e.target.value)}
                        placeholder="e.g. Maya"
                      />
                    </label>
                    <label>
                      Personal Email
                      <input
                        type="email"
                        value={personalEmail}
                        onChange={(e) => setPersonalEmail(e.target.value)}
                        placeholder="maya.personal@example.com"
                      />
                    </label>
                  </div>
                  <div className="auth-row" style={{ marginTop: "12px" }}>
                    <label>
                      Work Phone
                      <input
                        type="tel"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="+91 98765 00000"
                      />
                    </label>
                    <label>
                      Personal Phone
                      <input
                        type="tel"
                        value={personalPhone}
                        onChange={(e) => setPersonalPhone(e.target.value)}
                        placeholder="+91 98765 11111"
                      />
                    </label>
                  </div>
                  <div className="auth-row" style={{ marginTop: "12px" }}>
                    <label>
                      Date of Birth
                      <input
                        type="date"
                        value={dateOfBirth}
                        onChange={(e) => setDateOfBirth(e.target.value)}
                      />
                    </label>
                    <label>
                      Gender
                      <select
                        value={gender}
                        onChange={(e) => setGender(e.target.value)}
                        className="filter-select"
                        style={{ width: "100%", height: "42px" }}
                      >
                        <option value="">Select gender</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Non-Binary">Non-Binary</option>
                        <option value="Prefer not to say">Prefer not to say</option>
                      </select>
                    </label>
                  </div>
                </div>

                {/* Section 3: Residential Address */}
                <div style={{ marginBottom: "20px" }}>
                  <h3 style={{ fontSize: "15px", color: "#0f172a", borderBottom: "1px solid #e2e8f0", paddingBottom: "8px", margin: "0 0 14px" }}>
                    3. Address
                  </h3>
                  <label>
                    Street Address
                    <input
                      type="text"
                      value={residentialStreet}
                      onChange={(e) => setResidentialStreet(e.target.value)}
                      placeholder="e.g. 104 Palm Grove Residency, 12th Main Road"
                    />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginTop: "12px" }}>
                    <label>
                      City
                      <input
                        type="text"
                        value={residentialCity}
                        onChange={(e) => setResidentialCity(e.target.value)}
                        placeholder="e.g. Bengaluru"
                      />
                    </label>
                    <label>
                      State
                      <input
                        type="text"
                        value={residentialState}
                        onChange={(e) => setResidentialState(e.target.value)}
                        placeholder="e.g. Karnataka"
                      />
                    </label>
                    <label>
                      PIN Code
                      <input
                        type="text"
                        value={residentialPostalCode}
                        onChange={(e) => setResidentialPostalCode(e.target.value)}
                        placeholder="e.g. 560001"
                      />
                    </label>
                  </div>
                </div>

                {/* Section 4: Emergency Contact */}
                <div style={{ marginBottom: "20px" }}>
                  <h3 style={{ fontSize: "15px", color: "#0f172a", borderBottom: "1px solid #e2e8f0", paddingBottom: "8px", margin: "0 0 14px" }}>
                    4. Emergency Contact
                  </h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                    <label>
                      Contact Name
                      <input
                        type="text"
                        value={emergencyName}
                        onChange={(e) => setEmergencyName(e.target.value)}
                        placeholder="e.g. Rajesh Rao"
                      />
                    </label>
                    <label>
                      Relationship
                      <input
                        type="text"
                        value={emergencyRel}
                        onChange={(e) => setEmergencyRel(e.target.value)}
                        placeholder="e.g. Spouse / Parent"
                      />
                    </label>
                    <label>
                      Emergency Phone
                      <input
                        type="tel"
                        value={emergencyPhone}
                        onChange={(e) => setEmergencyPhone(e.target.value)}
                        placeholder="+91 98765 22222"
                      />
                    </label>
                  </div>
                </div>

                {/* Section 5: Bank & Tax Information */}
                <div style={{ marginBottom: "20px" }}>
                  <h3 style={{ fontSize: "15px", color: "#0f172a", borderBottom: "1px solid #e2e8f0", paddingBottom: "8px", margin: "0 0 14px" }}>
                    5. Bank & Tax Details
                  </h3>
                  <div className="auth-row">
                    <label>
                      Account Holder Name
                      <input
                        type="text"
                        value={accountHolderName}
                        onChange={(e) => setAccountHolderName(e.target.value)}
                        placeholder="Name on bank account"
                      />
                    </label>
                    <label>
                      Bank Name
                      <input
                        type="text"
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        placeholder="e.g. HDFC Bank"
                      />
                    </label>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginTop: "12px" }}>
                    <label>
                      Account Number
                      <input
                        type="text"
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value)}
                        placeholder="e.g. 5010012345678"
                      />
                    </label>
                    <label>
                      IFSC Code
                      <input
                        type="text"
                        value={ifscCode}
                        onChange={(e) => setIfscCode(e.target.value)}
                        placeholder="e.g. HDFC0001024"
                      />
                    </label>
                    <label>
                      Account Type
                      <select
                        value={accountType}
                        onChange={(e) => setAccountType(e.target.value)}
                        className="filter-select"
                        style={{ width: "100%", height: "42px" }}
                      >
                        <option value="SAVINGS">Savings</option>
                        <option value="CURRENT">Current</option>
                        <option value="SALARY">Salary</option>
                      </select>
                    </label>
                  </div>
                  <div className="auth-row" style={{ marginTop: "12px" }}>
                    <label>
                      PAN Number
                      <input
                        type="text"
                        value={panNumber}
                        onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                        placeholder="e.g. ABCDE1234F"
                      />
                    </label>
                  </div>
                </div>
              </>
            )}

            {formError && (
              <p role="alert" className="error" style={{ marginBottom: "16px" }}>
                {formError}
              </p>
            )}

            <button type="submit" disabled={submitting} style={{ width: "100%", padding: "12px" }}>
              {submitting
                ? "Setting up your account..."
                : isEmployeeFlow
                ? "Complete Onboarding"
                : "Complete Setup"}
            </button>
          </form>

          <div
            style={{
              marginTop: "24px",
              paddingTop: "16px",
              borderTop: "1px solid #eaecf0",
              fontSize: "14px",
              color: "#667085",
              textAlign: "center",
            }}
          >
            <span>Already have an account? </span>
            <Link to="/login" replace style={{ color: "#18181b", textDecoration: "none", fontWeight: "600" }}>
              Sign in
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
