import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import Expandable from "../../components/Expandable";
import { ErrorState, Skeleton } from "../../components/EmptyState";
import { useToast } from "../../components/Toast";
import api from "../../services/api";

const empty = {
  fullName: "",
  preferredName: "",
  personalEmail: "",
  phoneNumber: "",
  personalPhone: "",
  city: "",
  jobTitle: "",
  department: "",
  jobGrade: "",
  employmentType: "Full-time Permanent",
  workLocation: "",
  status: "ACTIVE",
  projectName: "",
  projectType: "MANDATE",
  monthlySalary: "",
  bankName: "",
  accountNumber: "",
  ifscCode: "",
  accountHolderName: "",
  accountType: "SAVINGS",
  panNumber: "",
  taxRegime: "NEW",
  emergencyContactName: "",
  emergencyContactRelationship: "",
  emergencyContactPhone: "",
};

export default function HrPersonEditPage() {
  const { id } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const setField = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/employees/${id}`);
        const emp = res.data?.employee || res.data;
        if (cancelled) return;
        setForm({
          fullName: emp.fullName || "",
          preferredName: emp.preferredName || "",
          personalEmail: emp.personalEmail || "",
          phoneNumber: emp.phoneNumber || "",
          personalPhone: emp.personalPhone || "",
          city: emp.city || emp.residentialAddress?.city || "",
          jobTitle: emp.job?.jobTitle || "",
          department: emp.job?.department || "",
          jobGrade: emp.job?.jobGrade || "",
          employmentType: emp.job?.employmentType || "Full-time Permanent",
          workLocation: emp.job?.workLocation || "",
          status: emp.status || "ACTIVE",
          projectName: emp.job?.project?.projectName || emp.job?.projectName || "",
          projectType: emp.job?.project?.projectType || emp.job?.projectType || "MANDATE",
          monthlySalary:
            emp.currentMonthlySalary ??
            emp.compensation?.monthlySalary ??
            emp.monthlySalary ??
            "",
          bankName: emp.bankDetails?.bankName || "",
          accountNumber: emp.bankDetails?.accountNumber || "",
          ifscCode: emp.bankDetails?.ifscCode || "",
          accountHolderName: emp.bankDetails?.accountHolderName || emp.fullName || "",
          accountType: emp.bankDetails?.accountType || "SAVINGS",
          panNumber: emp.taxDetails?.panNumber || "",
          taxRegime: emp.taxDetails?.taxRegime || "NEW",
          emergencyContactName: emp.emergencyContact?.name || "",
          emergencyContactRelationship: emp.emergencyContact?.relationship || "",
          emergencyContactPhone: emp.emergencyContact?.phone || "",
        });
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || "Could not load this profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!form.fullName.trim()) {
      setError("Full name is required.");
      return;
    }
    try {
      setSaving(true);
      setError("");
      const payload = {
        fullName: form.fullName.trim(),
        preferredName: form.preferredName.trim(),
        personalEmail: form.personalEmail.trim(),
        personalPhone: form.personalPhone.trim(),
        phoneNumber: form.phoneNumber.trim(),
        city: form.city.trim(),
        jobTitle: form.jobTitle.trim(),
        department: form.department.trim(),
        jobGrade: form.jobGrade.trim(),
        employmentType: form.employmentType.trim(),
        workLocation: form.workLocation.trim(),
        status: form.status,
        projectName: form.projectName.trim(),
        projectType: form.projectType,
        emergencyContact: {
          name: form.emergencyContactName.trim(),
          relationship: form.emergencyContactRelationship.trim(),
          phone: form.emergencyContactPhone.trim(),
        },
        residentialAddress: { city: form.city.trim(), country: "India" },
        bankDetails: {
          accountHolderName: (form.accountHolderName || form.fullName).trim(),
          bankName: form.bankName.trim(),
          accountNumber: form.accountNumber.trim(),
          ifscCode: form.ifscCode.trim(),
          accountType: form.accountType || "SAVINGS",
        },
        taxDetails: { panNumber: form.panNumber.trim(), taxRegime: form.taxRegime || "NEW" },
      };
      if (form.monthlySalary !== "" && form.monthlySalary != null) {
        payload.monthlySalary = parseFloat(form.monthlySalary);
      }
      await api.patch(`/employees/${id}`, payload);
      toast.push("Profile saved.");
      navigate(`/admin/employees/${id}`, { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || "Could not save this profile.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <><PageHeader title="Edit profile" back /><Skeleton /></>;
  if (error && !form.fullName) return <><PageHeader title="Edit profile" back /><ErrorState message={error} onRetry={() => navigate(-1)} /></>;

  return (
    <>
      <PageHeader title="Edit profile" back />
      {error ? <div className="alert alert-error">{error}</div> : null}
      <form className="form-grid" onSubmit={save}>
        <Expandable title="Identity" defaultOpen>
          <label>Full name<input value={form.fullName} onChange={setField("fullName")} /></label>
          <label>Preferred name<input value={form.preferredName} onChange={setField("preferredName")} /></label>
          <label>Personal email<input type="email" value={form.personalEmail} onChange={setField("personalEmail")} /></label>
          <label>Phone<input type="tel" value={form.phoneNumber} onChange={setField("phoneNumber")} /></label>
          <label>City<input value={form.city} onChange={setField("city")} /></label>
        </Expandable>
        <Expandable title="Job">
          <label>Job title<input value={form.jobTitle} onChange={setField("jobTitle")} /></label>
          <label>Department<input value={form.department} onChange={setField("department")} /></label>
          <label>Employment type<input value={form.employmentType} onChange={setField("employmentType")} /></label>
          <label>Project<input value={form.projectName} onChange={setField("projectName")} /></label>
          <label>
            Status
            <select value={form.status} onChange={setField("status")}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        </Expandable>
        <Expandable title="Pay and bank">
          <label>Monthly salary<input type="number" value={form.monthlySalary} onChange={setField("monthlySalary")} /></label>
          <label>Bank<input value={form.bankName} onChange={setField("bankName")} /></label>
          <label>Account number<input value={form.accountNumber} onChange={setField("accountNumber")} /></label>
          <label>IFSC<input value={form.ifscCode} onChange={setField("ifscCode")} /></label>
          <label>PAN<input value={form.panNumber} onChange={setField("panNumber")} /></label>
        </Expandable>
        <Expandable title="Emergency contact">
          <label>Name<input value={form.emergencyContactName} onChange={setField("emergencyContactName")} /></label>
          <label>Relationship<input value={form.emergencyContactRelationship} onChange={setField("emergencyContactRelationship")} /></label>
          <label>Phone<input type="tel" value={form.emergencyContactPhone} onChange={setField("emergencyContactPhone")} /></label>
        </Expandable>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button>
      </form>
    </>
  );
}
