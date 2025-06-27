document.addEventListener("DOMContentLoaded", () => {
  const hamburger = document.querySelector(".hamburger");
  const navMenu = document.querySelector(".nav-menu");
  const body = document.body;
  const profileContainer = document.querySelector(".profile-container");
  const profileDropdown = document.querySelector(".profile-dropdown");

  // Update Navbar Based on localStorage
  function updateNavbar() {
    const user = localStorage.getItem("user");
    const profileSection = document.getElementById("profile-section");
    const loginSection = document.getElementById("login-section");
    const profileImg = document.getElementById("profile-img");
    const profileName = document.getElementById("profile-name");
    const profileEmail = document.getElementById("profile-email");
    const adminLink = document.getElementById("admin-link");

    if (user) {
      const userData = JSON.parse(user);
      profileSection.classList.add("active");
      loginSection.classList.add("active");
      profileImg.src =
        userData.profileImage ||
        "https://www.gravatar.com/avatar/?d=identicon" ||
        "/images/default-avatar.jpg";
      profileName.textContent = userData.name || "User";
      profileEmail.textContent = userData.email || "";
      if (userData.role === "admin") {
        adminLink.style.display = "flex";
      }
    } else {
      profileSection.classList.remove("active");
      loginSection.classList.remove("active");
    }
  }

  // Initial Navbar Update
  updateNavbar();

  // Hamburger Menu Toggle
  if (hamburger && navMenu) {
    hamburger.addEventListener("click", () => {
      const isActive = hamburger.classList.toggle("active");
      navMenu.classList.toggle("active");
      body.style.overflow = isActive ? "hidden" : "";
      hamburger.setAttribute("aria-expanded", isActive);
    });
  }

  // Handle Dropdowns and Sub-Dropdowns
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach((item) => {
    const link = item.querySelector(".nav-link");
    const dropdown = item.querySelector(".dropdown");

    if (dropdown && link) {
      link.addEventListener("click", (e) => {
        if (window.innerWidth <= 768) {
          e.preventDefault();
          const isActive = item.classList.contains("active");
          navItems.forEach((i) => i.classList.remove("active"));
          if (!isActive) {
            item.classList.add("active");
            link.setAttribute("aria-expanded", "true");
          } else {
            link.setAttribute("aria-expanded", "false");
          }
        }
      });
    }

    document.querySelectorAll(" .nav-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        const href = link.getAttribute("href");
        if (href && href.startsWith("#")) {
          e.preventDefault();
          const targetElement = document.querySelector(href);
          if (targetElement) {
            targetElement.scrollIntoView({ behavior: "smooth" });
            const ripple = document.createElement("span");
            ripple.style.position = "absolute";
            ripple.style.borderRadius = "50%";
            ripple.style.background = "rgba(255, 255, 255, 0.6)";
            ripple.style.transform = "scale(0)";
            ripple.style.animation = "ripple 0.6s linear";
            const rect = link.getBoundingClientRect();
            ripple.style.left = `${e.clientX - rect.left}px`;
            ripple.style.top = `${e.clientY - rect.top}px`;
            link.appendChild(ripple);
            setTimeout(() => ripple.remove(), 600);
          }
        }
      });
    });

    const subDropdownItems = item.querySelectorAll(".has-sub-dropdown");
    subDropdownItems.forEach((subItem) => {
      const subToggle = subItem.querySelector(".sub-dropdown-toggle");
      const subDropdown = subItem.querySelector(".sub-dropdown");
      if (subToggle && subDropdown) {
        subToggle.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const isActive = subItem.classList.contains("active");
          subDropdownItems.forEach((i) => i.classList.remove("active"));
          if (!isActive) {
            subItem.classList.add("active");
            subToggle.setAttribute("aria-expanded", "true");
          } else {
            subToggle.setAttribute("aria-expanded", "false");
          }
        });
      }
    });
  });

  // Toggle Profile Dropdown on Mobile
  if (profileContainer && profileDropdown) {
    profileContainer.addEventListener("click", (e) => {
      if (window.innerWidth <= 768) {
        // e.preventDefault();
        const isActive = profileContainer.classList.contains("active");
        profileContainer.classList.toggle("active", !isActive);
        profileContainer.setAttribute("aria-expanded", !isActive);
      }
    });
  }

  // Close Menu on Outside Click
  document.addEventListener("click", (e) => {
    if (!navMenu.contains(e.target) && !hamburger.contains(e.target)) {
      hamburger.classList.remove("active");
      navMenu.classList.remove("active");
      navItems.forEach((item) => {
        item.classList.remove("active");
        const link = item.querySelector(".nav-link");
        if (link) link.setAttribute("aria-expanded", "false");
        const subDropdownItems = item.querySelectorAll(".has-sub-dropdown");
        subDropdownItems.forEach((subItem) => {
          subItem.classList.remove("active");
          const subToggle = subItem.querySelector(".sub-dropdown-toggle");
          if (subToggle) subToggle.setAttribute("aria-expanded", "false");
        });
      });
      if (profileContainer) {
        profileContainer.classList.remove("active");
        profileContainer.setAttribute("aria-expanded", "false");
      }
      body.style.overflow = "";
      hamburger.setAttribute("aria-expanded", "false");
    }
  });

  // Keyboard Accessibility
  navItems.forEach((item) => {
    const link = item.querySelector(".nav-link");
    const dropdown = item.querySelector(".dropdown");
    if (dropdown && link) {
      link.addEventListener("focus", () => {
        navItems.forEach((i) => i.classList.remove("focus-within"));
        item.classList.add("focus-within");
      });
      link.addEventListener("blur", (e) => {
        if (!item.contains(e.relatedTarget)) {
          item.classList.remove("focus-within");
        }
      });
    }

    const subDropdownItems = item.querySelectorAll(".has-sub-dropdown");
    subDropdownItems.forEach((subItem) => {
      const subToggle = subItem.querySelector(".sub-dropdown-toggle");
      const subDropdown = subItem.querySelector(".sub-dropdown");
      if (subToggle && subDropdown) {
        subToggle.addEventListener("focus", () => {
          subItem.classList.add("focus-within");
        });
        subToggle.addEventListener("blur", (e) => {
          if (!subItem.contains(e.relatedTarget)) {
            subItem.classList.remove("focus-within");
          }
        });
      }
    });
  });

  // Scroll Effect
  window.addEventListener("scroll", () => {
    const navbar = document.querySelector(".navbar");
    const backToTop = document.querySelector(".back-to-top");
    if (window.scrollY > 100) {
      navbar.style.background = "rgba(255, 255, 255, 0.98)";
      navbar.style.boxShadow = "0 2px 20px rgba(0, 0, 0, 0.1)";
      if (backToTop) backToTop.classList.add("show");
    } else {
      navbar.style.background = "rgba(255, 255, 255, 0.95)";
      navbar.style.boxShadow = "none";
      if (backToTop) backToTop.classList.remove("show");
    }
  });

  // Login Redirect
  function handleLoginRedirect() {
    const currentUrl = encodeURIComponent(
      window.location.pathname + window.location.search
    );
    window.location.href = `/signup?redirect=${currentUrl}`;
  }

  // Logout Function
});
function logout() {
  localStorage.removeItem("user");
  fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  }).then(() => {
    window.location.href = "/";
  });
  updateNavbar(); // Update navbar immediately
}
