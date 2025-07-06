function initSidebar() {
  const hamburger = document.getElementById("hamburger");
  const sidebar = document.getElementById("sidebar");
  if (!hamburger || !sidebar) return;

  hamburger.addEventListener("click", () => {
    sidebar.classList.toggle("hidden");
    sidebar.classList.toggle("active");
    hamburger.innerHTML = sidebar.classList.contains("active")
      ? '<i class="fas fa-times sidebar-close"></i>'
      : '<i class="fas fa-bars"></i>';
  });

  document.querySelectorAll(".sidebar-nav a").forEach((link) => {
    link.addEventListener("click", () => {
      sidebar.classList.remove("active");
      sidebar.classList.add("hidden");
      hamburger.innerHTML = '<i class="fas fa-bars"></i>';
    });
  });
}

function logout() {
  fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  })
    .then(() => {
      localStorage.removeItem("user");
      window.location.href = "/signup?redirect=/dashboard";
    })
    .catch((error) => {
      console.error("Logout error:", error);
      alert("Error logging out. Please try again.");
    });
}

document.addEventListener("DOMContentLoaded", initSidebar);
