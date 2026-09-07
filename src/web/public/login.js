const form = document.getElementById("loginForm");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  loginBtn.disabled = true;
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordInput.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Sign in failed");
    location.href = data.redirect || "/tracking";
  } catch (error) {
    loginError.textContent = error.message || "Sign in failed";
    loginBtn.disabled = false;
  }
});
