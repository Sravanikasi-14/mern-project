import {
  clearPlatformAuthCookie,
  setPlatformAuthCookie,
} from "../utils/platformAuthCookie.js";
import {
  confirmMfaSetup,
  getPlatformMe,
  platformLogin,
  platformLogout,
  startMfaSetup,
  verifyMfa,
} from "../services/platformAuthService.js";

export async function login(req, res, next) {
  try {
    const result = await platformLogin({
      email: req.body?.email,
      password: req.body?.password,
      req,
    });
    // Full session cookie only when a session token was issued
    // (MFA completed, or development-only MFA bypass).
    if (result?.token) {
      setPlatformAuthCookie(res, result.token, { maxAgeMs: result.maxAgeMs });
      return res.status(200).json({
        admin: result.admin,
        expiresAt: result.expiresAt,
        token: result.token,
        mfaBypassed: Boolean(result.mfaBypassed),
        requiresMfa: false,
        requiresMfaSetup: false,
      });
    }
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function mfaSetupStart(req, res, next) {
  try {
    const result = await startMfaSetup({
      mfaToken: req.body?.mfaToken,
      req,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function mfaSetupConfirm(req, res, next) {
  try {
    const result = await confirmMfaSetup({
      mfaToken: req.body?.mfaToken,
      code: req.body?.code,
      req,
    });
    setPlatformAuthCookie(res, result.token, { maxAgeMs: result.maxAgeMs });
    res.status(200).json({
      admin: result.admin,
      expiresAt: result.expiresAt,
      recoveryCodes: result.recoveryCodes,
      token: result.token,
    });
  } catch (err) {
    next(err);
  }
}

export async function mfaVerify(req, res, next) {
  try {
    const result = await verifyMfa({
      mfaToken: req.body?.mfaToken,
      code: req.body?.code,
      recoveryCode: req.body?.recoveryCode,
      req,
    });
    setPlatformAuthCookie(res, result.token, { maxAgeMs: result.maxAgeMs });
    res.status(200).json({
      admin: result.admin,
      expiresAt: result.expiresAt,
      token: result.token,
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(req, res, next) {
  try {
    await platformLogout({
      token: req.platformAuth?.token,
      admin: req.platformAuth?.admin,
      req,
    });
    clearPlatformAuthCookie(res);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    const result = await getPlatformMe(req.platformAuth.admin);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
