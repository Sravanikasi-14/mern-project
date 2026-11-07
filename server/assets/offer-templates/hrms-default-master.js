/**
 * HRMS default master offer-letter template (HRMS_DEFAULT_V1).
 *
 * Modelled on a professional multi-page Indian employment offer (Letter size, ~10 pages):
 *   Page 1   - centered letterhead, Date/Place, OFFER LETTER, body, HR signature,
 *              candidate acceptance declaration + Employee Name / Signature / Date
 *   Page 2-9 - Employment terms (navy section titles with underline, bold lead-ins)
 *   Final    - EXECUTION page (witness statement, HR + employee signature blocks, footer contact line)
 *
 * No personal names, phone numbers, or company branding live here. Every company-specific
 * value is supplied through `{{placeholders}}` (inside the section text) or through the
 * `context` object passed to `buildMasterOfferHtml`. All values are HTML-escaped; callers
 * pass RAW values.
 *
 * Signature images:
 *   context.hrSignatureDataUrl        HR / signatory image (safe data URL only)
 *   context.hrTypedSignature          fallback typed text (cursive) when there is no image
 *   context.candidateSignatureDataUrl candidate image (safe data URL only)
 *   context.candidateTypedSignature   fallback typed text for the candidate
 * Candidate slots are rendered as stable markers so a frozen issued document can receive
 * the candidate signature later without re-rendering the legal text
 * (see `injectCandidateSignature`).
 */

export const MASTER_TEMPLATE_CODE = "HRMS_DEFAULT_V1";
export const MASTER_TEMPLATE_TITLE = "HRMS Default Offer Letter";
export const MASTER_TEMPLATE_VERSION = 1;
export const MASTER_TEMPLATE_KIND = "DEFAULT_BUILDER";

/** Placeholders understood inside section text (snake_case). */
export const MASTER_PLACEHOLDERS = Object.freeze([
  "company_name",
  "company_email",
  "company_phone",
  "company_website",
  "company_address",
  "candidate_name",
  "candidate_email",
  "designation",
  "department",
  "employment_type",
  "work_location",
  "reporting_manager",
  "joining_date",
  "offer_date",
  "monthly_salary",
  "monthly_salary_rs",
  "annual_salary",
  "annual_salary_rs",
  "probation_months",
  "probation_notice_days",
  "notice_period_days",
  "non_solicitation_months",
  "office_hours",
  "working_days",
  "acceptance_days",
  "signatory_name",
  "signatory_title",
  "place",
]);

/** Cover-letter (page 1) configuration. Text supports **bold** and placeholders. */
export const MASTER_COVER = Object.freeze({
  id: "cover_letter",
  kind: "cover",
  title: "OFFER LETTER",
  salutation: "Dear {{candidate_name}},",
  paragraphs: Object.freeze([
    "We are pleased to inform you that you have been selected for the role of **{{designation}}** at {{company_name}}. We were impressed by your candidature through the interview process, and we believe your skills and enthusiasm will be a valuable addition to our team. Your employment with us will be governed by the following terms, along with the policies, procedures and practices of {{company_name}} as may be applicable and amended from time to time.",
    "Your **designation** will be **{{designation}}**, and your employment will be on a **{{employment_type}}** basis. Your date of joining will be {{joining_date}}. Your **monthly compensation** will be {{monthly_salary_rs}} of which shall be subject to applicable statutory deductions, tax withholding and other deductions as required by law. Any sales incentive or commission payable to you, where applicable, shall be governed separately by the company's prevailing incentive policy as communicated to you from time to time and may be revised at the company's discretion.",
    "We look forward to having you on board and to a mutually rewarding association. To indicate your acceptance of this offer and its terms, kindly sign and return a copy of this letter to the company at the earliest.",
  ]),
  closing: "For **{{company_name}}**",
  acceptance:
    "I, {{candidate_name}}, accept the employment offer extended to me by {{company_name}} and confirm that I have read, understood and agree to be bound by the terms and conditions set forth in this Offer Letter.",
});

/**
 * Legal sections (page 2 onwards). Each term has an optional bold `lead` followed by `text`.
 * Placeholders are resolved at render time. Wording follows the reference offer closely.
 */
export const DEFAULT_LEGAL_SECTIONS = Object.freeze([
  {
    id: "employment_terms",
    order: 1,
    title: "EMPLOYMENT TERMS AND CONDITIONS",
    isRequired: true,
    terms: [
      {
        id: "acceptance_duties",
        lead: "",
        text: "By accepting the employment offered to you by {{company_name}}, you understand and agree that you shall diligently, faithfully and professionally perform the duties assigned to you in connection with your position as {{designation}}, and that you shall carry out these duties to the best of your ability at all times. You shall comply with the applicable rules, policies, procedures, instructions and reasonable directives issued by {{company_name}} from time to time, and you shall maintain professional conduct in all your work-related activities so as to protect and promote the interests and reputation of the company at every stage.",
      },
      {
        id: "attendance_compensation",
        lead: "",
        text: "You shall maintain regular attendance and punctuality in the discharge of your duties, and shall promptly and proactively communicate to your reporting manager any unavoidable absence, delay or circumstance that may affect your availability. You shall obtain the required approvals for any planned leave in advance and shall follow the company's applicable leave process in this regard. You further acknowledge that your compensation, as detailed above, is subject to applicable taxes, statutory deductions and any other terms communicated to you by the company from time to time, and that where applicable, sales incentives or commissions payable to you shall be governed by the company's prevailing incentive structure, which may be reviewed or revised at the company's discretion.",
      },
      {
        id: "performance_review_notice",
        lead: "",
        text: "You further understand that the company may, from time to time, review your performance based on the reasonable requirements of your role, and that you shall immediately inform the company of any circumstance that may materially affect your ability to perform your duties, so that appropriate support or action can be considered.",
      },
      {
        id: "probation",
        lead: "Probation.",
        text: "You shall initially be subject to a probationary period of {{probation_months}} months from your date of joining. Your confirmation in the role, or any extension of the probationary period, or any other action in this regard, shall be communicated to you by the company in writing, in accordance with the applicable terms of your employment and the law.",
      },
      {
        id: "working_hours",
        lead: "Working Hours.",
        text: "You shall follow the working days and hours communicated to you by {{company_name}} ({{working_days}}, {{office_hours}}, unless otherwise notified), and shall extend reasonable flexibility in situations where business requirements call for client meetings, calls, events or other related activities outside of your standard working hours.",
      },
      {
        id: "performance",
        lead: "Performance.",
        text: "Your performance may be assessed by the company having regard to factors such as the quality of your work, your productivity, your professionalism, your attendance record, your handling of clients, your overall sales contribution and any other reasonable requirements considered relevant to your position.",
      },
      {
        id: "reporting_structure",
        lead: "Reporting Structure.",
        text: "You shall report to the reporting manager or supervisor assigned to you by the company, and shall follow the reporting lines, work allocation and instructions communicated to you from time to time. The company reserves the right to modify your reporting structure, team placement or supervising authority as may be required for legitimate business reasons, and any such change shall be communicated to you in advance wherever practicable.",
      },
      {
        id: "place_of_work",
        lead: "Place of Work and Transfer.",
        text: "You shall be based at the company's office in {{work_location}}, or at such other location as may be communicated to you. The company reserves the right, at its discretion and for legitimate business reasons, to transfer, relocate or reassign you to any other office, branch, project or location of the company, whether within the same city or elsewhere, subject to reasonable prior notice and applicable law.",
      },
    ],
  },
  {
    id: "compensation_benefits_leave",
    order: 2,
    title: "COMPENSATION, BENEFITS AND LEAVE",
    isRequired: true,
    terms: [
      {
        id: "salary_payment",
        lead: "Salary Payment and Structure.",
        text: "Your monthly compensation of {{monthly_salary_rs}} shall ordinarily be credited to your designated bank account by the company on or around the last working day of each calendar month, or on such other date as the company may determine from time to time. The detailed break-up of your compensation, including basic pay, allowances and any other components, shall be communicated to you separately through your compensation structure or payslip, and may be modified by the company from time to time in accordance with its compensation policy, applicable law and business requirements.",
      },
      {
        id: "statutory_benefits",
        lead: "Statutory Benefits.",
        text: "Where applicable under law, you shall be enrolled for statutory benefits such as the Employees' Provident Fund (EPF), Employees' State Insurance (ESI) or other applicable social security schemes, and the company shall make such contributions as are required of it under the relevant statutes. You shall be responsible for providing accurate documentation and information as may be required for such enrolment and compliance.",
      },
      {
        id: "other_benefits",
        lead: "Other Benefits.",
        text: "You may, subject to eligibility criteria and the company's prevailing policy, be entitled to additional benefits such as group medical or personal accident insurance, reimbursement of approved business expenses, mobile or internet allowances where applicable to your role, and any other benefit that the company may introduce from time to time. Such benefits, where extended, shall be governed by their respective policy documents and may be modified, suspended or discontinued by the company at its discretion, subject to applicable law.",
      },
      {
        id: "leave_entitlement",
        lead: "Leave Entitlement.",
        text: "You shall be entitled to leave, including casual leave, sick leave, earned or privilege leave, and such other categories of leave as may be provided under the company's leave policy and applicable law, including any applicable Shops and Establishments legislation. The specific number of leave days, the manner of their accrual, and the process for availing and encashing leave, shall be as set out in the company's leave policy as communicated to you and as may be revised from time to time.",
      },
      {
        id: "public_holidays",
        lead: "Public Holidays.",
        text: "You shall be entitled to public holidays as per the list notified by the company at the commencement of each calendar year, which shall generally be in line with the holidays observed in the state in which your place of work is located, subject to business requirements that may require your availability on certain days, particularly in connection with client engagements.",
      },
    ],
  },
  {
    id: "policies_conduct",
    order: 3,
    title: "COMPANY POLICIES AND EMPLOYEE OBLIGATIONS",
    isRequired: false,
    terms: [
      {
        id: "code_of_conduct",
        lead: "Code of Conduct.",
        text: "You are expected to act at all times with honesty, integrity, professionalism and courtesy towards your colleagues, clients, vendors and other business partners of the company. Abusive, threatening, discriminatory, fraudulent or otherwise seriously inappropriate conduct of any kind, whether directed at colleagues, clients or any other person in a work-related context, shall not be tolerated and may result in appropriate disciplinary action.",
      },
      {
        id: "client_communication",
        lead: "Client Communication.",
        text: "You shall communicate accurately, professionally and transparently with clients and prospective clients at all times. You are not authorised to make any unauthorised promises, guarantees, discounts, refunds, service commitments or contractual commitments on behalf of the company, whether express or implied, without the specific prior approval of the company.",
      },
      {
        id: "ethical_sales",
        lead: "Ethical Sales Practices.",
        text: "You shall not, under any circumstance, request or accept any unauthorised personal payment, kickback or benefit from any client or prospective client, and you shall not falsify, alter or misrepresent any sales records, quotations, invoices or other business information in the course of your work.",
      },
      {
        id: "crm_systems",
        lead: "CRM and Company Systems.",
        text: "You shall ensure that all company leads, prospects, follow-ups, proposals and other relevant sales activity are accurately and promptly maintained in the designated company systems and CRM tools. Company records, in any form, must not be concealed, manipulated, copied or transferred outside the company without proper authorisation, and any attempt to do so shall be treated as a serious breach of trust.",
      },
      {
        id: "company_leads",
        lead: "Company Leads.",
        text: "You acknowledge that all leads and client opportunities generated through {{company_name}}'s website, marketing campaigns, employees, CRM systems, social media channels, advertising initiatives, events or any other company activity are, and shall remain, business opportunities belonging to the company, and shall not be diverted, redirected or exploited by you for any personal or third-party benefit, whether during or after your employment.",
      },
      {
        id: "data_protection",
        lead: "Data Protection.",
        text: "You shall handle all company and client information responsibly and in accordance with applicable data protection practices. You shall take reasonable steps to protect your passwords, devices, accounts and confidential records from unauthorised access, and shall promptly report any suspected loss, unauthorised access or disclosure of such information to the company.",
      },
      {
        id: "social_media",
        lead: "Social Media.",
        text: "You shall not publish, post or otherwise share any confidential company information, internal communications, client information or unauthorised statements concerning the company on social media platforms or any other public forum, whether during or after the term of your employment.",
      },
      {
        id: "workplace_respect",
        lead: "Workplace Respect.",
        text: "{{company_name}} is committed to maintaining a workplace founded on mutual respect, dignity and fairness for all its employees. Harassment, bullying, intimidation, discrimination and any form of inappropriate conduct, in any form, are strictly prohibited and will be addressed seriously in accordance with the company's applicable policy and the law.",
      },
      {
        id: "posh",
        lead: "Prevention of Sexual Harassment (POSH).",
        text: "The company shall maintain, and shall continue to follow, all applicable statutory requirements relating to the prevention, prohibition and redressal of sexual harassment at the workplace, and is committed to providing a safe working environment to all employees. Any complaint of sexual harassment shall be dealt with promptly, confidentially and impartially in accordance with the company's applicable policy and the law, through its Internal Committee constituted for this purpose.",
      },
      {
        id: "grievance_redressal",
        lead: "Grievance Redressal.",
        text: "Should you have any grievance relating to your employment, your working conditions, or the conduct of any colleague, you are encouraged to raise the same, in the first instance, with your reporting manager, and thereafter, if unresolved, with the human resources department of the company. The company shall make reasonable efforts to address and resolve genuine grievances in a fair, timely and confidential manner, in accordance with its applicable grievance-redressal policy.",
      },
      {
        id: "anti_bribery",
        lead: "Anti-Bribery and Anti-Corruption.",
        text: "You shall not, directly or indirectly, offer, give, solicit or accept any bribe, illegal gratification or improper benefit, whether in cash or in kind, to or from any client, vendor, government official or other person, in connection with the business of the company. You shall conduct all business dealings on behalf of {{company_name}} with honesty and in compliance with applicable anti-bribery and anti-corruption laws, and shall promptly report any instance of suspected bribery or corruption that comes to your attention.",
      },
      {
        id: "health_safety",
        lead: "Health and Safety.",
        text: "You shall take reasonable care for your own health and safety and that of your colleagues while at the workplace, and shall comply with the company's applicable health, safety and emergency procedures. You shall promptly report any unsafe condition, accident or workplace hazard that comes to your notice to your reporting manager or to the human resources department.",
      },
      {
        id: "it_email_usage",
        lead: "Information Technology and Email Usage.",
        text: "Any use by you of the company's computers, email accounts, internet access, software and other information-technology resources shall be primarily for legitimate business purposes, in accordance with the company's applicable IT and acceptable-use policy. The company reserves the right, subject to applicable law, to monitor, access and review the use of its systems and accounts, including email communications sent or received using company resources, for legitimate business, security or compliance purposes.",
      },
    ],
  },
  {
    id: "confidentiality",
    order: 4,
    title: "CONFIDENTIALITY AND PROPRIETARY INFORMATION",
    isRequired: false,
    terms: [
      {
        id: "confidential_definition",
        lead: "",
        text: "For the purposes of your employment, Confidential Information shall include all non-public information relating to the business of {{company_name}}, including without limitation client and prospective-client data, lead databases, pricing information, proposals, contracts, sales and marketing strategies, financial or commercial information, internal processes, credentials, systems, documents, training materials and business plans of the company.",
      },
      {
        id: "confidential_use",
        lead: "",
        text: "Confidential Information may be accessed and used by you only for the legitimate performance of your duties on behalf of {{company_name}}, and only to the extent that you are specifically authorised to do so. Except where disclosure is required by applicable law or has been expressly authorised by the company in writing, you shall not reveal, publish, transfer, copy or otherwise disclose any Confidential Information to any person or entity, whether directly or indirectly, and shall exercise reasonable care at all times to prevent its unauthorised access, disclosure, copying, loss or misuse, following the company's applicable information-security procedures in this regard.",
      },
      {
        id: "confidential_return",
        lead: "",
        text: "Upon termination of your employment, or upon request by the company at any time, you shall promptly return or securely delete all Confidential Information belonging to the company that is in your possession, and shall not retain any unauthorised copies thereof, whether in physical or electronic form. You further acknowledge that your obligation to protect the company's Confidential Information shall continue even after the termination or separation of your employment, for so long as such information remains confidential or proprietary in nature, subject to applicable law.",
      },
    ],
  },
  {
    id: "intellectual_property",
    order: 5,
    title: "INTELLECTUAL PROPERTY AND COMPANY MATERIALS",
    isRequired: false,
    terms: [
      {
        id: "work_product",
        lead: "",
        text: "All work product, proposals, presentations, sales materials, reports, databases, processes, documents, strategies and other materials created, developed or compiled by you in the course of your employment with {{company_name}} shall be treated as the work product and property of the company, to the fullest extent permitted by applicable law. You shall not use any company-owned or confidential materials for your personal benefit, for any competing business, or for the benefit of any third party, without the prior written authorisation of the company.",
      },
      {
        id: "non_solicitation",
        lead: "Non-Solicitation.",
        text: "During your employment with {{company_name}} and for a period of {{non_solicitation_months}} months following the termination or cessation of your employment for any reason, you shall not, directly or indirectly, solicit, induce or attempt to solicit or induce any client, prospective client, vendor or business partner of the company, with whom you had material dealings during your employment, to discontinue, reduce or divert their business relationship with {{company_name}}, nor shall you solicit or induce any employee of the company to leave their employment with {{company_name}}, to the extent permitted under applicable law.",
      },
      {
        id: "non_compete",
        lead: "Non-Compete.",
        text: "During the term of your employment with {{company_name}}, you shall not, without the prior written consent of the company, engage or participate in any business, employment, consultancy or activity that directly competes with the business of {{company_name}}, whether on your own account or on behalf of any other person or entity. This obligation shall apply strictly during the subsistence of your employment, and any post-employment restriction, to the extent applicable, shall be limited to what is reasonable and enforceable under applicable law.",
      },
    ],
  },
  {
    id: "company_property_protection",
    order: 6,
    title: "COMPANY PROPERTY, CONFLICTS AND BUSINESS PROTECTION",
    isRequired: false,
    terms: [
      {
        id: "company_property",
        lead: "Company Property.",
        text: "Any laptops, mobile devices, SIM cards, documents, software accounts, credentials, files and other assets provided to you by {{company_name}} shall be used by you responsibly and solely for legitimate business purposes, and shall be returned to the company promptly when requested or upon the separation of your employment, in good working condition, ordinary wear and tear excepted.",
      },
      {
        id: "account_security",
        lead: "Account Security.",
        text: "You acknowledge that the company's email systems, CRM, social media accounts, software and other similar accounts are company-controlled resources at all times. You shall protect all passwords and access credentials entrusted to you, and shall not transfer or share the same with any other person without proper authorisation from the company.",
      },
      {
        id: "conflict_of_interest",
        lead: "Conflict of Interest.",
        text: "You shall promptly disclose to the company any actual or potential conflict between your personal interests and the interests of {{company_name}}, and shall not, under any circumstances, misuse the company's resources, information, leads or clients for your own benefit or for the benefit of any third party.",
      },
      {
        id: "outside_activities",
        lead: "Outside Activities.",
        text: "Any outside employment, consultancy, freelancing or other business activity undertaken by you that conflicts with your responsibilities to {{company_name}}, competes with the business of the company, or misuses the company's information or resources in any manner, shall require the prior written approval of the company before you undertake the same.",
      },
      {
        id: "client_lead_protection",
        lead: "Client and Lead Protection.",
        text: "During the term of your employment, you shall not use the company's confidential information, records or systems, in any manner, to divert the company's clients, leads or business opportunities for your own personal benefit or for the benefit of any third party, and any such conduct shall be treated as a serious violation of your obligations under this letter.",
      },
      {
        id: "expenses",
        lead: "Expenses.",
        text: "Business expenses reasonably and properly incurred by you in the course of your employment may be reimbursed by the company, provided that such expenses are business-related, have been appropriately approved in advance where required, and are supported by the necessary documentation in accordance with the company's expense policy.",
      },
      {
        id: "training",
        lead: "Training.",
        text: "You may, from time to time, be required by the company to complete training relating to sales processes, client communication, service knowledge, CRM usage, information security, professional conduct and other job-related requirements as considered necessary by the company.",
      },
      {
        id: "policy_updates",
        lead: "Policy Updates.",
        text: "{{company_name}} reserves the right to introduce, amend or update its internal policies and procedures from time to time, as it considers appropriate for the conduct of its business, subject always to applicable law and to your contractual rights as an employee.",
      },
    ],
  },
  {
    id: "resignation_termination",
    order: 7,
    title: "RESIGNATION, NOTICE AND TERMINATION",
    isRequired: true,
    terms: [
      {
        id: "resignation",
        lead: "Resignation.",
        text: "Following the confirmation of your employment, either you or the company may terminate the employment relationship by providing {{notice_period_days}} days' written notice to the other party, or such other notice period as may otherwise be specified in your applicable employment terms and as permitted under the law.",
      },
      {
        id: "probation_notice",
        lead: "Probation Notice.",
        text: "During the period of your probation, the applicable notice period required for termination of your employment by either party shall be {{probation_notice_days}} days, unless otherwise communicated to you by the company in writing and subject always to applicable law.",
      },
      {
        id: "notice_administration",
        lead: "Notice Administration.",
        text: "The company may, where permitted, at its discretion accept payment in lieu of notice from you, or may waive or reduce the applicable notice period. All resignations tendered by you must be submitted formally and in writing to your reporting manager or to the human resources department of the company.",
      },
      {
        id: "handover",
        lead: "Handover.",
        text: "Before your final working day with the company, you shall be required to complete all reasonable handover requirements as instructed by the company, including the completion of pending work, the transfer of client and lead information, updates to the CRM, the handover of documents, and the return of all company property and access credentials in your possession.",
      },
      {
        id: "termination",
        lead: "Termination.",
        text: "{{company_name}} may terminate your employment in accordance with the applicable employment terms, the company's policies and the law, including, without limitation, in circumstances involving serious misconduct, fraud, dishonesty, a serious breach of confidentiality, misuse of company or client data, repeated violations of company policy, or any other legitimate ground recognised under applicable law.",
      },
      {
        id: "performance_concerns",
        lead: "Performance Concerns.",
        text: "Where your performance does not meet the reasonable expectations of your role, the company shall generally provide you with appropriate feedback, guidance, training or a formal performance-improvement process before taking any further employment action, except in circumstances that, in the company's reasonable assessment, justify immediate action under applicable policy or law.",
      },
      {
        id: "exit_settlement",
        lead: "Exit and Final Settlement.",
        text: "The final settlement of your eligible salary, reimbursements and any other dues applicable to you shall be processed by the company in accordance with its standard procedure and applicable law, subject to the completion of all required exit formalities by you and the return of all company property in your possession.",
      },
    ],
  },
  {
    id: "general",
    order: 8,
    title: "GENERAL PROVISIONS",
    isRequired: false,
    terms: [
      {
        id: "entire_understanding",
        lead: "Entire Understanding.",
        text: "This Offer Letter, read together with the applicable policies of the company and any subsequent employment documentation issued to you, sets out the complete terms governing this offer of employment, and supersedes any inconsistent prior representations made to you concerning the same subject matter, to the extent permitted by applicable law.",
      },
      {
        id: "amendments",
        lead: "Amendments.",
        text: "Any material amendment to the contractual terms of your employment shall be communicated to you in writing, wherever such written communication is required under applicable law or company policy.",
      },
      {
        id: "severability",
        lead: "Severability.",
        text: "Should any provision of this Offer Letter be held to be invalid or unenforceable under applicable law, the remaining provisions of this letter shall nonetheless continue to remain in full force and effect, to the extent legally permissible.",
      },
      {
        id: "no_waiver",
        lead: "No Waiver.",
        text: "The failure of either party to enforce any particular provision of this Offer Letter on a given occasion shall not be construed as, or treated as, a permanent waiver of that provision by such party.",
      },
      {
        id: "governing_law",
        lead: "Governing Law.",
        text: "Your employment relationship with {{company_name}} shall be governed by the laws of India, together with such other laws and regulations as may be applicable.",
      },
      {
        id: "dispute_resolution",
        lead: "Dispute Resolution.",
        text: "In the event of any employment-related dispute, the parties shall first make a genuine, good-faith attempt to resolve such dispute through internal discussion. Where such internal resolution is not possible, the dispute shall thereafter be addressed through the appropriate legal forum and procedure available under applicable law.",
      },
      {
        id: "background_verification",
        lead: "Background and Document Verification.",
        text: "Where {{company_name}} requires verification of any information or documents provided by you during the course of recruitment, this offer of employment shall remain subject to the satisfactory completion of such verification. Should any materially false or misleading information be discovered, the company reserves the right to withdraw this offer, or to take appropriate employment action, subject to applicable law.",
      },
      {
        id: "statutory_rights",
        lead: "Statutory Rights.",
        text: "Nothing contained in this Offer Letter is intended to remove, reduce or waive any statutory right or protection that may otherwise be available to you as an employee under applicable law.",
      },
      {
        id: "notices",
        lead: "Notices.",
        text: "Any notice or communication required to be given by either party under this Offer Letter shall be in writing and shall be deemed to have been duly given if delivered by hand, sent by registered post, or sent by email to the address or email address last notified by the recipient party, and shall be deemed to have been received in the ordinary course of transmission, unless proven otherwise.",
      },
      {
        id: "assignment",
        lead: "Assignment.",
        text: "This Offer Letter is personal to you and you shall not assign, transfer or delegate any of your rights or obligations under it to any other person. The company may, in connection with a merger, acquisition, restructuring or transfer of its business, assign its rights and obligations under this Offer Letter, and your employment shall, to the extent permitted under applicable law, continue with the successor entity on substantially similar terms.",
      },
      {
        id: "force_majeure",
        lead: "Force Majeure.",
        text: "Neither party shall be held liable for any failure or delay in performing its obligations under this Offer Letter where such failure or delay arises from circumstances reasonably beyond that party's control, including natural disaster, pandemic, governmental action, strike, or other similar event, provided that the affected party takes reasonable steps to mitigate the impact of such circumstances and to resume performance as soon as reasonably practicable.",
      },
      {
        id: "final_acknowledgement",
        lead: "",
        text: "You acknowledge that you have read and understood the terms of this Offer Letter in their entirety, and that you agree to comply with the applicable policies and procedures of {{company_name}} as in force from time to time.",
      },
    ],
  },
]);

/** Execution page configuration. */
export const MASTER_EXECUTION = Object.freeze({
  id: "execution",
  kind: "execution",
  title: "EXECUTION",
  statement:
    "IN WITNESS WHEREOF, the parties acknowledge and accept the terms of this Offer Letter.",
});

/** Full ordered structure: cover -> legal sections -> execution. */
export const MASTER_SECTIONS = Object.freeze([
  MASTER_COVER,
  ...DEFAULT_LEGAL_SECTIONS.map((s) => ({ ...s, kind: "section" })),
  MASTER_EXECUTION,
]);

/** Plain-JSON config persisted on the master and copied into tenant templates. */
export function getMasterSectionConfig() {
  return JSON.parse(
    JSON.stringify({
      cover: MASTER_COVER,
      execution: MASTER_EXECUTION,
      defaults: {
        probationMonths: 3,
        probationNoticeDays: 30,
        noticeDays: 60,
        nonSolicitationMonths: 6,
        officeHours: "09:30 AM to 06:30 PM",
        workingDays: "Monday to Friday",
        acceptanceDays: 5,
      },
    })
  );
}

export function getDefaultLegalSections() {
  return JSON.parse(JSON.stringify(DEFAULT_LEGAL_SECTIONS));
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

export function esc(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fmtDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

/** dd-mm-yyyy (used for the candidate's signing date, as on the reference). */
function fmtDateNumeric(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function toNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && !/^[\d.,\s]+$/.test(value)) return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string" && !/^[\d.,\s]+$/.test(value)) return value; // already formatted
  const n = toNumber(value);
  if (n == null) return String(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

/** "Rs. 15,000" - matches the reference wording and renders in every font. */
function fmtRupees(value) {
  if (value == null || value === "") return "";
  const n = toNumber(value);
  if (n == null) return String(value);
  return `Rs. ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n)}`;
}

/** Only allow safe raster data URLs for the logo <img>. */
function safeLogoSrc(src) {
  if (typeof src !== "string") return "";
  return /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : "";
}

/**
 * Only allow safe data URLs for signature <img> (raster, or the server-generated typed SVG).
 * Anything else (remote URLs, javascript:, uploaded SVG with embedded markup) is dropped.
 */
export function safeSignatureSrc(src) {
  if (typeof src !== "string") return "";
  return /^data:image\/(png|jpe?g|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : "";
}

/** `<img class="sig-img">` for a safe data URL; empty string when unsafe / missing. */
export function renderSigImg(dataUrl) {
  const src = safeSignatureSrc(dataUrl);
  return src ? `<img class="sig-img" src="${src}" alt="Signature" />` : "";
}

function renderTypedSig(text) {
  const t = text == null ? "" : String(text).trim().slice(0, 80);
  return t ? `<span class="sig-typed">${esc(t)}</span>` : "";
}

/** Signature graphic: image if safe, else typed cursive text, else empty. */
function renderSignatureMark(dataUrl, typedText) {
  return renderSigImg(dataUrl) || renderTypedSig(typedText);
}

/** Build the `{{key}}` -> raw value map from a render context. */
export function buildPlaceholderValues(context = {}) {
  const defaults = context.defaults || {};
  const monthly = context.monthlySalary;
  const annualRaw =
    context.annualSalary != null && context.annualSalary !== ""
      ? context.annualSalary
      : Number.isFinite(Number(monthly))
        ? Number(monthly) * 12
        : "";
  return {
    company_name: context.companyName || "",
    company_email: context.companyEmail || "",
    company_phone: context.companyPhone || "",
    company_website: context.companyWebsite || "",
    company_address: context.companyAddress || "",
    candidate_name: context.candidateName || "",
    candidate_email: context.candidateEmail || "",
    designation: context.designation || "",
    department: context.department || "the relevant",
    employment_type: context.employmentType || "Full-time Permanent",
    work_location: context.workLocation || "the Company's office",
    reporting_manager: context.reportingManager || "your designated manager",
    joining_date: fmtDate(context.joiningDate),
    offer_date: fmtDate(context.offerDate || new Date()),
    monthly_salary: fmtMoney(monthly),
    monthly_salary_rs: fmtRupees(monthly),
    annual_salary: fmtMoney(annualRaw),
    annual_salary_rs: fmtRupees(annualRaw),
    probation_months: context.probationMonths ?? defaults.probationMonths ?? 3,
    probation_notice_days: context.probationNoticeDays ?? defaults.probationNoticeDays ?? 30,
    notice_period_days: context.noticeDays ?? defaults.noticeDays ?? 60,
    non_solicitation_months:
      context.nonSolicitationMonths ?? defaults.nonSolicitationMonths ?? 6,
    office_hours: context.officeHours || defaults.officeHours || "09:30 AM to 06:30 PM",
    working_days: context.workingDays || defaults.workingDays || "Monday to Friday",
    acceptance_days: context.acceptanceDays ?? defaults.acceptanceDays ?? 5,
    signatory_name: context.signatoryName || "",
    signatory_title: context.signatoryTitle || "Authorized Signatory",
    place: context.place || context.workLocation || "",
  };
}

/** Escape text, resolve `{{key}}` placeholders (escaped) and `**bold**` markup. */
export function renderRichText(text, values) {
  let out = esc(text || "");
  out = out.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, key) => {
    const k = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(values, k) ? esc(values[k]) : match;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return out;
}

const NAVY = "#1F3864";

const MASTER_CSS = `
  @page { size: Letter portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #ffffff; }
  body {
    font-family: Arial, Helvetica, "Liberation Sans", sans-serif;
    font-size: 11.5px;
    line-height: 1.95;
    color: #111827;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* Fixed-size pages (cover, execution): ~0.85in side margins as on the reference. */
  .page {
    width: 8.5in;
    margin: 0 auto;
    padding: 0.7in 0.85in 0.6in;
    break-after: page;
    page-break-after: always;
  }
  .page:last-child { break-after: auto; page-break-after: auto; }
  /* Flowing legal text: padding is repeated on every printed page fragment. */
  .flow {
    width: 8.5in;
    margin: 0 auto;
    padding: 0.7in 0.85in;
    break-after: page;
    page-break-after: always;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
  .letterhead { text-align: center; }
  .letterhead img.logo { max-height: 56px; max-width: 200px; object-fit: contain; display: block; margin: 0 auto 6px; }
  .company-name { font-size: 15px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; color: #111827; }
  .contact-line { margin-top: 5px; font-size: 9px; color: #4b5563; }
  .contact-line .sep { margin: 0 5px; }
  .rule { border: 0; border-top: 1.5px solid ${NAVY}; margin: 10px 0 14px; }
  .meta { font-size: 11px; line-height: 1.7; }
  .doc-title { text-align: center; font-size: 12.5px; font-weight: 700; color: #111827; margin: 30px 0 18px; }
  .salutation { margin-bottom: 8px; }
  .body-para { text-align: justify; margin-bottom: 16px; }
  .body-para strong { font-weight: 700; }
  .for-company { margin-top: 4px; }
  .sig-area { height: 56px; margin: 4px 0 6px; display: flex; align-items: flex-end; }
  .sig-img { max-height: 54px; max-width: 200px; object-fit: contain; display: block; }
  .sig-typed { font-family: "Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive; font-size: 24px; color: #1e3a8a; line-height: 1.1; }
  .sig-blank { width: 190px; border-bottom: 1px solid #374151; height: 1px; }
  .sig-name, .sig-title { font-weight: 700; }
  .accept { text-align: justify; margin: 20px 0 12px; }
  .emp-row { line-height: 1.95; }
  .sig-line-wrap { display: inline-block; vertical-align: bottom; min-width: 190px; border-bottom: 1px solid #374151; min-height: 18px; line-height: 1; text-align: left; }
  .sig-slot { display: inline-block; vertical-align: bottom; min-width: 150px; min-height: 18px; }
  .sig-slot .sig-img { max-height: 40px; max-width: 180px; }
  .sig-slot .sig-typed { font-size: 20px; }
  .date-line { display: inline-block; min-width: 150px; border-bottom: 1px solid #374151; text-align: center; }
  .section { margin-bottom: 26px; }
  .section-title {
    font-size: 12px; font-weight: 700; text-transform: uppercase; color: ${NAVY};
    border-bottom: 1px solid ${NAVY}; padding-bottom: 4px; margin-bottom: 16px;
    break-after: avoid; page-break-after: avoid;
  }
  .term { margin-bottom: 22px; text-align: justify; }
  .term .lead { font-weight: 700; }
  .execution-statement { margin: 8px 0 14px; }
  .exec-heading { font-weight: 700; }
  .exec-block { margin-top: 36px; }
  .exec-block .exec-heading { margin-bottom: 4px; }
  .page-footer { margin-top: 110px; text-align: center; font-size: 9px; color: #4b5563; }
  .page-footer .sep { margin: 0 5px; }
`;

function joinWithSep(parts) {
  return parts.map((p) => esc(p)).join('<span class="sep">|</span>');
}

function cleanParts(parts) {
  return parts.map((p) => (p == null ? "" : String(p).trim())).filter(Boolean);
}

function renderContactLine(context) {
  const parts = cleanParts([context.companyWebsite, context.companyEmail, context.companyPhone]).map((p) =>
    p.replace(/^https?:\/\//i, "").replace(/\/$/, "")
  );
  if (parts.length === 0) return "";
  return `<div class="contact-line">${joinWithSep(parts)}</div>`;
}

function renderLetterhead(context) {
  const logo = safeLogoSrc(context.logoDataUrl);
  return `
    <div class="letterhead">
      ${logo ? `<img class="logo" src="${logo}" alt="" />` : ""}
      <div class="company-name">${esc(String(context.companyName || "").toUpperCase())}</div>
      ${renderContactLine(context)}
    </div>
    <hr class="rule" />`;
}

/** HR / company signatory block: "For Company", signature graphic (or blank line), (Name), Title. */
function renderHrBlock(context, values, closingHtml) {
  const mark = renderSignatureMark(context.hrSignatureDataUrl, context.hrTypedSignature);
  return `
    <div class="for-company">${closingHtml}</div>
    <div class="sig-area">${mark || '<div class="sig-blank"></div>'}</div>
    <div class="sig-name">(${values.signatory_name ? esc(values.signatory_name) : "Authorized Signatory"})</div>
    <div class="sig-title">${esc(values.signatory_title)}</div>`;
}

/** Candidate image slot + date, as stable markers (see injectCandidateSignature). */
function candidateSlotHtml(context) {
  const mark = renderSignatureMark(context.candidateSignatureDataUrl, context.candidateTypedSignature);
  return `<span class="sig-slot" data-sig-slot="candidate">${mark}</span>`;
}

function candidateDateHtml(context) {
  const signedAt = context.signature && context.signature.signedAt;
  const text = signedAt ? esc(fmtDateNumeric(signedAt)) : "&nbsp;";
  return `<span class="date-line" data-sig-date="candidate">${text}</span>`;
}

const CANDIDATE_SLOT_EMPTY = '<span class="sig-slot" data-sig-slot="candidate"></span>';
const CANDIDATE_DATE_EMPTY = '<span class="date-line" data-sig-date="candidate">&nbsp;</span>';

/**
 * Put the candidate's signature into an already-rendered (frozen) offer document without
 * touching any other content. Returns the same HTML and `injected: false` if the document
 * predates the candidate markers.
 *
 * @param {string} html
 * @param {{ dataUrl?: string, typedText?: string, signedAt?: Date|string }} sig
 */
export function injectCandidateSignature(html, sig = {}) {
  const source = String(html || "");
  if (!source.includes(CANDIDATE_SLOT_EMPTY)) return { html: source, injected: false };
  const mark = renderSignatureMark(sig.dataUrl, sig.typedText);
  const dateText = sig.signedAt ? esc(fmtDateNumeric(sig.signedAt)) : "&nbsp;";
  const slot = `<span class="sig-slot" data-sig-slot="candidate">${mark}</span>`;
  const date = `<span class="date-line" data-sig-date="candidate">${dateText}</span>`;
  const out = source.split(CANDIDATE_SLOT_EMPTY).join(slot).split(CANDIDATE_DATE_EMPTY).join(date);
  return { html: out, injected: true };
}

/**
 * Build the complete multi-page offer HTML.
 *
 * @param {object} context RAW (unescaped) values. Recognised keys:
 *   companyName, companyWebsite, companyEmail, companyPhone, companyAddress, logoDataUrl,
 *   candidateName, candidateEmail, designation, department, employmentType, workLocation,
 *   reportingManager, joiningDate, offerDate, place, monthlySalary, annualSalary,
 *   signatoryName, signatoryTitle, probationMonths, probationNoticeDays, noticeDays,
 *   nonSolicitationMonths, officeHours, workingDays, acceptanceDays,
 *   hrSignatureDataUrl, hrTypedSignature, candidateSignatureDataUrl, candidateTypedSignature,
 *   signature{signerName, signedAt}, sections (override legal sections), cover, execution, defaults
 * @returns {string} HTML document
 */
export function buildMasterOfferHtml(context = {}) {
  const values = buildPlaceholderValues(context);
  const cover = { ...MASTER_COVER, ...(context.cover || {}) };
  const execution = { ...MASTER_EXECUTION, ...(context.execution || {}) };
  const sections = (Array.isArray(context.sections) && context.sections.length > 0
    ? context.sections
    : DEFAULT_LEGAL_SECTIONS
  )
    .filter((s) => s && s.enabled !== false && s.isIncluded !== false)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const paragraphsHtml = (cover.paragraphs || [])
    .map((p) => `<p class="body-para">${renderRichText(p, values)}</p>`)
    .join("\n");

  const sectionsHtml = sections
    .map((section) => {
      const termsHtml = (section.terms || [])
        .filter((t) => t && t.enabled !== false)
        .map((t) => {
          const lead = t.lead ? `<span class="lead">${renderRichText(t.lead, values)}</span> ` : "";
          return `<div class="term">${lead}${renderRichText(t.text, values)}</div>`;
        })
        .join("\n");
      return `
      <div class="section">
        <div class="section-title">${esc(section.title || "")}</div>
        ${termsHtml}
      </div>`;
    })
    .join("\n");

  const footerParts = cleanParts([context.companyWebsite, context.companyEmail, context.companyPhone]).map(
    (p) => p.replace(/^https?:\/\//i, "").replace(/\/$/, "")
  );

  const title = `${esc(cover.title || "OFFER LETTER")}${values.candidate_name ? ` - ${esc(values.candidate_name)}` : ""}`;
  const place = String(values.place || "").replace(/\s*[\r\n]+\s*/g, ", ");
  const closingHtml = renderRichText(cover.closing || "For **{{company_name}}**", values);
  const acceptanceHtml = renderRichText(cover.acceptance || MASTER_COVER.acceptance, values);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>${MASTER_CSS}</style>
</head>
<body data-offer-layout="letter">
  <!-- Page 1: cover letter -->
  <section class="page" data-section="cover">
    ${renderLetterhead(context)}
    <div class="meta">
      <div>Date: ${esc(values.offer_date)}</div>
      ${place ? `<div>Place: ${esc(place)}</div>` : ""}
    </div>
    <div class="doc-title">${esc(cover.title || "OFFER LETTER")}</div>
    <div class="salutation">${renderRichText(cover.salutation || "Dear {{candidate_name}},", values)}</div>
    ${paragraphsHtml}
    ${renderHrBlock(context, values, closingHtml)}
    <p class="accept">${acceptanceHtml}</p>
    <div class="emp-row">Employee Name: ${esc(values.candidate_name)}</div>
    <div class="emp-row">Employee Signature: <span class="sig-line-wrap">${candidateSlotHtml(context)}</span></div>
    <div class="emp-row">Date: ${candidateDateHtml(context)}</div>
  </section>

  <!-- Terms of employment (flows across pages) -->
  <section class="flow" data-section="terms">
    ${sectionsHtml}
  </section>

  <!-- Final page: execution -->
  <section class="page" data-section="execution">
    <div class="section">
      <div class="section-title">${esc(execution.title || "EXECUTION")}</div>
      <p class="execution-statement">${renderRichText(execution.statement || "", values)}</p>
      ${renderHrBlock(context, values, closingHtml)}
      <div class="exec-block">
        <div class="exec-heading">Employee</div>
        <div class="emp-row">Name: ${esc(values.candidate_name)}</div>
        <div class="emp-row">Signature: <span class="sig-line-wrap">${candidateSlotHtml(context)}</span></div>
        <div class="emp-row">Date: ${candidateDateHtml(context)}</div>
      </div>
    </div>
    ${footerParts.length ? `<div class="page-footer">${joinWithSep(footerParts)}</div>` : ""}
  </section>
</body>
</html>`;
}

export default {
  MASTER_TEMPLATE_CODE,
  MASTER_SECTIONS,
  DEFAULT_LEGAL_SECTIONS,
  buildMasterOfferHtml,
  injectCandidateSignature,
  renderSigImg,
};
