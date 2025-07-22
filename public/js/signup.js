const API_URL = "http://localhost:5000/api/auth";
let currentEmail = "";
let isResetPasswordStep = false;

// Get redirect URL from query parameter
const urlParams = new URLSearchParams(window.location.search);
const redirectUrl = urlParams.get("redirect") || "/";
window.redirectUrl = redirectUrl;

// Check if user is already logged in
document.addEventListener("DOMContentLoaded", async () => {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  if (user && user.expiresAt && user.expiresAt < Date.now()) {
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    showError("Session expired. Please log in again.");
    showLogin();
    return;
  }

  if (user.name && user.email) {
    try {
      const response = await fetch(`${API_URL}/validate-session`, {
        method: "GET",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      if (response.ok) {
        showSuccess("You are already logged in. Redirecting to dashboard.");
        setTimeout(() => {
          window.location.href = user.role === "admin" ? "/admin" : "/dashboard";
        }, 1000);
      } else {
        localStorage.removeItem("user");
        localStorage.removeItem("token");
        showError("Session expired. Please log in again.");
        showLogin();
      }
    } catch (error) {
      console.error("Session Validation Error:", error);
      localStorage.removeItem("user");
      localStorage.removeItem("token");
      showError("Network error. Please log in again.");
      showLogin();
    }
  } else {
    // Check for Google OAuth callback error
    const error = urlParams.get("error");
    if (error) {
      showError(decodeURIComponent(error));
    }
    showLogin();
  }
});

function showLogin() {
  hideAllForms();
  document.getElementById("loginForm").style.display = "block";
  document.querySelectorAll(".form-toggle button")[0].classList.add("active");
  document
    .querySelectorAll(".form-toggle button")[1]
    .classList.remove("active");
  clearMessages();
}

function showSignup() {
  hideAllForms();
  document.getElementById("signupForm").style.display = "block";
  document
    .querySelectorAll(".form-toggle button")[0]
    .classList.remove("active");
  document.querySelectorAll(".form-toggle button")[1].classList.add("active");
  clearMessages();
}

function showOtpForm() {
  hideAllForms();
  document.getElementById("otpForm").style.display = "block";
  clearMessages();
}

function showForgotPassword() {
  hideAllForms();
  document.getElementById("forgotPasswordForm").style.display = "block";
  document.getElementById("forgotEmailGroup").style.display = "block";
  document.getElementById("resetOtpGroup").style.display = "none";
  document.getElementById("newPasswordGroup").style.display = "none";
  document.getElementById("confirmNewPasswordGroup").style.display = "none";
  document.getElementById("newPasswordStrength").style.display = "none";
  document.getElementById("forgotTitle").textContent = "Reset Password";
  document.getElementById("forgotBtn").innerHTML =
    '<i class="fas fa-paper-plane"></i> Send OTP';

  const forgotEmail = document.getElementById("forgotEmail");
  const resetOtp = document.getElementById("resetOtp");
  const newPassword = document.getElementById("newPassword");
  const confirmNewPassword = document.getElementById("confirmNewPassword");
  if (forgotEmail) forgotEmail.required = true;
  if (resetOtp) resetOtp.required = false;
  if (newPassword) newPassword.required = false;
  if (confirmNewPassword) confirmNewPassword.required = false;

  isResetPasswordStep = false;
  clearMessages();
}

function hideAllForms() {
  document.getElementById("loginForm").style.display = "none";
  document.getElementById("signupForm").style.display = "none";
  document.getElementById("otpForm").style.display = "none";
  document.getElementById("forgotPasswordForm").style.display = "none";
}

function showError(message) {
  const errorDiv = document.getElementById("errorMessage");
  if (errorDiv) {
    errorDiv.innerHTML = message;
    errorDiv.style.display = "block";
    document.getElementById("successMessage").style.display = "none";
  }
}

function showSuccess(message) {
  const successDiv = document.getElementById("successMessage");
  if (successDiv) {
    successDiv.textContent = message;
    successDiv.style.display = "block";
    document.getElementById("errorMessage").style.display = "none";
  }
}

function clearMessages() {
  const errorDiv = document.getElementById("errorMessage");
  const successDiv = document.getElementById("successMessage");
  if (errorDiv) errorDiv.style.display = "none";
  if (successDiv) successDiv.style.display = "none";
}

function disableButton(btn) {
  if (btn) {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.innerHTML =
      '<span class="loading"><i class="fas fa-spinner fa-spin"></i> Processing...</span>';
  }
}

function enableButton(btn, originalText) {
  if (btn) {
    btn.disabled = false;
    btn.setAttribute("aria-busy", "false");
    btn.innerHTML = originalText;
  }
}

function checkPasswordStrength(password, strengthDivId) {
  const strengthDiv = document.getElementById(strengthDivId);
  if (!strengthDiv) return false;

  strengthDiv.style.display = "block";
  if (password.length < 6) {
    strengthDiv.textContent = "Weak: Password must be at least 6 characters";
    strengthDiv.className = "password-strength weak";
    return false;
  } else if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    strengthDiv.textContent = "Medium: Include uppercase and numbers";
    strengthDiv.className = "password-strength medium";
    return true;
  } else {
    strengthDiv.textContent = "Strong: Good password!";
    strengthDiv.className = "password-strength strong";
    return true;
  }
}

function togglePassword(inputId, button) {
  const input = document.getElementById(inputId);
  const icon = button.querySelector("i");
  if (input.type === "password") {
    input.type = "text";
    icon.classList.remove("fa-eye");
    icon.classList.add("fa-eye-slash");
  } else {
    input.type = "password";
    icon.classList.remove("fa-eye-slash");
    icon.classList.add("fa-eye");
  }
}

function closePage() {
  const authContainer = document.getElementById("authContainer");
  if (authContainer) {
    authContainer.classList.add("closing");
    setTimeout(() => {
      const url = window.redirectUrl || "/";
      window.location.href = url;
    }, 500);
  }
}

function socialLogin(provider) {
  if (provider === "Google") {
    // Redirect to Google OAuth endpoint with state parameter
    const redirectParam = encodeURIComponent(window.redirectUrl);
    window.location.href = `${API_URL}/google?state=${redirectParam}`;
  } else {
    showError(`${provider} login is not implemented yet.`);
  }
}

// Signup Form Submission
document.getElementById("signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("signupName")?.value.trim();
  const email = document.getElementById("signupEmail")?.value.trim();
  const password = document.getElementById("signupPassword")?.value;
  const confirmPassword = document.getElementById("confirmPassword")?.value;
  const signupBtn = document.getElementById("submitSignup");
  const originalText = '<i class="fas fa-user-plus"></i> Signup';

  if (!name || !email || !password || !confirmPassword || !signupBtn) {
    showError("Form elements are missing. Please refresh the page.");
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError("Please enter a valid email address.");
    return;
  }

  if (password !== confirmPassword) {
    showError("Passwords do not match.");
    return;
  }

  if (!checkPasswordStrength(password, "passwordStrength")) {
    showError("Please enter a stronger password.");
    return;
  }

  disableButton(signupBtn);

  try {
    const response = await fetch(`${API_URL}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        name,
        email,
        password,
        redirect: window.redirectUrl,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      currentEmail = email;
      showOtpForm();
      showSuccess(data.message || "OTP sent to your email.");
    } else if (data.message === "User already exists") {
      showError(
        'Email already registered. Please <a href="#" onclick="showLogin()">login</a>.'
      );
    } else {
      showError(data.message || "Signup failed. Please try again.");
    }
  } catch (error) {
    showError("Network error during signup. Please check your connection.");
    console.error("Signup Error:", error);
  } finally {
    enableButton(signupBtn, originalText);
  }
});

// OTP Verification
document.getElementById("otpForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const otp = document.getElementById("otpInput")?.value.trim();
  const otpBtn = document.getElementById("otpBtn");
  const originalText = '<i class="fas fa-check"></i> Verify OTP';

  if (!otp || !otpBtn) {
    showError("Form elements are missing. Please refresh the page.");
    return;
  }

  if (!/^\d{6}$/.test(otp)) {
    showError("OTP must be a 6-digit number.");
    return;
  }

  disableButton(otpBtn);

  try {
    const response = await fetch(`${API_URL}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email: currentEmail,
        otp,
        redirect: window.redirectUrl,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      const userData = {
        ...data.user,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(userData));
      showSuccess("OTP verified successfully!");
      setTimeout(() => {
        const url =
          data.redirect ||
          (data.user.role === "admin" ? "/admin" : "/dashboard");
        window.location.href = url;
      }, 1000);
    } else {
      showError(data.message || "Invalid OTP. Please try again.");
    }
  } catch (error) {
    showError("Network error during OTP verification.");
    console.error("OTP Error:", error);
  } finally {
    enableButton(otpBtn, originalText);
  }
});

// Resend OTP
async function resendOTP() {
  if (!currentEmail) {
    showError("No email associated. Please sign up again.");
    return;
  }

  try {
    const response = await fetch(`${API_URL}/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email: currentEmail,
        redirect: window.redirectUrl,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      showSuccess(data.message || "OTP resent to your email.");
    } else {
      showError(data.message || "Failed to resend OTP.");
    }
  } catch (error) {
    showError("Network error while resending OTP.");
    console.error("Resend OTP Error:", error);
  }
}

// Login Form Submission
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail")?.value.trim();
  const password = document.getElementById("loginPassword")?.value;
  const loginBtn = document.getElementById("loginBtn");
  const originalText = '<i class="fas fa-sign-in-alt"></i> Login';

  if (!email || !password || !loginBtn) {
    showError("Form elements are missing. Please refresh the page.");
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError("Please enter a valid email address.");
    return;
  }

  disableButton(loginBtn);

  try {
    const response = await fetch(`${API_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, redirect: window.redirectUrl }),
    });

    const data = await response.json();

    if (response.ok) {
      const userData = {
        ...data.user,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(userData));
      showSuccess("Login successful!");
      setTimeout(() => {
        const url =
          data.redirect ||
          (data.user.role === "admin" ? "/admin" : "/dashboard");
        window.location.href = url;
      }, 1000);
    } else if (data.message === "User already logged in") {
      localStorage.setItem("user", JSON.stringify(data.user));
      localStorage.setItem("token", data.token);
      showSuccess("You are already logged in. Redirecting...");
      setTimeout(() => {
        const url =
          data.redirect ||
          (data.user.role === "admin" ? "/admin" : "/dashboard");
        window.location.href = url;
      }, 1000);
    } else {
      showError(data.message || "Login failed. Please try again.");
    }
  } catch (error) {
    showError("Network error during login.");
    console.error("Login Error:", error);
  } finally {
    enableButton(loginBtn, originalText);
  }
});

// Forgot Password Form Submission
document
  .getElementById("forgotPasswordForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("forgotEmail")?.value.trim();
    const otp = document.getElementById("resetOtp")?.value.trim();
    const newPassword = document.getElementById("newPassword")?.value;
    const confirmNewPassword =
      document.getElementById("confirmNewPassword")?.value;
    const forgotBtn = document.getElementById("forgotBtn");
    let originalText = '<i class="fas fa-paper-plane"></i> Send OTP';

    if (!forgotBtn) {
      showError("Form elements are missing. Please refresh the page.");
      return;
    }

    disableButton(forgotBtn);

    if (!isResetPasswordStep) {
      if (!email) {
        showError("Please enter your email address.");
        enableButton(forgotBtn, originalText);
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError("Please enter a valid email address.");
        enableButton(forgotBtn, originalText);
        return;
      }

      try {
        const response = await fetch(`${API_URL}/forgot-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, redirect: window.redirectUrl }),
        });

        const data = await response.json();

        if (response.ok) {
          currentEmail = email;
          document.getElementById("forgotEmailGroup").style.display = "none";
          document.getElementById("resetOtpGroup").style.display = "block";
          document.getElementById("newPasswordGroup").style.display = "block";
          document.getElementById("confirmNewPasswordGroup").style.display =
            "block";
          document.getElementById("newPasswordStrength").style.display =
            "block";
          document.getElementById("forgotTitle").textContent =
            "Enter OTP & New Password";
          document.getElementById("resetOtp").required = true;
          document.getElementById("newPassword").required = true;
          document.getElementById("confirmNewPassword").required = true;
          originalText = '<i class="fas fa-unlock"></i> Reset Password';
          forgotBtn.innerHTML = originalText;
          isResetPasswordStep = true;
          showSuccess(data.message || "OTP sent to your email.");
        } else {
          showError(data.message || "Failed to send OTP.");
        }
      } catch (error) {
        showError("Network error during password reset request.");
        console.error("Forgot Password Error:", error);
      } finally {
        enableButton(forgotBtn, originalText);
      }
    } else {
      if (!otp || !newPassword || !confirmNewPassword) {
        showError("Please fill in all fields.");
        enableButton(forgotBtn, originalText);
        return;
      }

      if (!/^\d{6}$/.test(otp)) {
        showError("OTP must be a 6-digit number.");
        enableButton(forgotBtn, originalText);
        return;
      }

      if (newPassword !== confirmNewPassword) {
        showError("Passwords do not match.");
        enableButton(forgotBtn, originalText);
        return;
      }

      if (!checkPasswordStrength(newPassword, "newPasswordStrength")) {
        showError("Please enter a stronger password.");
        enableButton(forgotBtn, originalText);
        return;
      }

      try {
        const response = await fetch(`${API_URL}/reset-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            email: currentEmail,
            otp,
            newPassword,
            redirect: window.redirectUrl,
          }),
        });

        const data = await response.json();

        if (response.ok) {
          showSuccess(data.message || "Password reset successfully.");
          setTimeout(() => showLogin(), 1000);
        } else {
          showError(data.message || "Failed to reset password.");
        }
      } catch (error) {
        showError("Network error during password reset.");
        console.error("Reset Password Error:", error);
      } finally {
        enableButton(forgotBtn, originalText);
      }
    }
  });

// Password Strength Real-time Check
document
  .getElementById("signupPassword")
  ?.addEventListener("input", function () {
    checkPasswordStrength(this.value, "passwordStrength");
  });

document.getElementById("newPassword")?.addEventListener("input", function () {
  checkPasswordStrength(this.value, "newPasswordStrength");
});

async function logout() {
  try {
    const response = await fetch(`${API_URL}/logout`, {
      method: "POST",
      credentials: "include",
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
    });

    if (response.ok) {
      localStorage.removeItem("user");
      localStorage.removeItem("token");
      showSuccess("Logged out successfully.");
      setTimeout(() => {
        window.location.href = "/signup";
      }, 1000);
    } else {
      showError("Failed to log out. Please try again.");
    }
  } catch (error) {
    showError("Network error during logout.");
    console.error("Logout Error:", error);
  }
}
