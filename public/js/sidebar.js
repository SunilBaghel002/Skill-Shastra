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

  // Handle active class on nav link click
  const navLinks = document.querySelectorAll(".sidebar-nav a");
  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      // Remove active class from all links
      navLinks.forEach((l) => l.classList.remove("active"));
      // Add active class to clicked link
      link.classList.add("active");
      // Close sidebar on mobile
      sidebar.classList.remove("active");
      sidebar.classList.add("hidden");
      hamburger.innerHTML = '<i class="fas fa-bars"></i>';
    });
  });

  // Highlight active link on page load based on current URL
  const currentPath = window.location.pathname;
  navLinks.forEach((link) => {
    const href = link.getAttribute("href");
    // Exact match for root and specific routes, partial match for subroutes
    if (
      href === currentPath || // Exact match for '/', '/dashboard', '/admin'
      (currentPath.startsWith("/dashboard/") && href === currentPath) || // Subroutes like '/dashboard/feedback'
      (currentPath.startsWith("/admin/") && href === currentPath) // Subroutes like '/admin/feedback'
    ) {
      link.classList.add("active");
    }
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
