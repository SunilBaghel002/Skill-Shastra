document.addEventListener("DOMContentLoaded", async () => {
  const announcementsList = document.getElementById("announcements");
  const errorMessage = document.getElementById("errorMessage");
  const successMessage = document.getElementById("successMessage");
  const loadingOverlay = document.getElementById("loading-overlay");

  // Map targetAudience values to display names
  const audienceDisplayMap = {
    "All Users": "All Users",
    "Frontend Development": "Frontend Development",
    "Backend Development": "Backend Development",
    "Full Stack Development": "Full Stack Development",
    "Digital Marketing": "Digital Marketing",
    "JavaScript Programming": "JavaScript Programming",
    "Java Programming": "Java Programming",
    "Python Programming": "Python Programming",
    "C++ Programming": "C++ Programming",
    "Programming Fundamentals": "Programming Fundamentals",
    "Gen AI": "Gen AI",
  };

  // Map announcement types to display names
  const typeDisplayMap = {
    general: "General",
    class_schedule: "Class Schedule",
    test: "Test",
    event: "Event",
  };

  // Show Error Message
  function showError(message) {
    if (errorMessage) {
      errorMessage.textContent = message;
      errorMessage.style.display = "block";
      successMessage.style.display = "none";
      setTimeout(() => (errorMessage.style.display = "none"), 5000);
    }
  }

  // Show Success Message
  function showSuccess(message) {
    if (successMessage) {
      successMessage.textContent = message;
      successMessage.style.display = "block";
      errorMessage.style.display = "none";
      setTimeout(() => (successMessage.style.display = "none"), 5000);
    }
  }

  // Fetch Enrollments and Announcements
  async function fetchData() {
    if (loadingOverlay) loadingOverlay.style.display = "flex";
    try {
      // Check enrollment status
      let enrollments = [];
      try {
        const enrollmentResponse = await fetch("/api/enrollments", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
        });

        if (!enrollmentResponse.ok) {
          if (enrollmentResponse.status === 401) {
            localStorage.removeItem("user");
            window.location.href = `/signup?redirect=${encodeURIComponent(
              window.location.pathname
            )}`;
            return;
          }
          throw new Error("Failed to fetch enrollments");
        }

        const enrollmentData = await enrollmentResponse.json();
        enrollments = enrollmentData.enrollments || [];
      } catch (error) {
        console.warn("Enrollment fetch failed, proceeding with announcements:", error);
        // Fallback: Continue to fetch announcements if /api/enrollments is not available
      }

      // If no enrollments, show prompt to enroll
      if (!enrollments || enrollments.length === 0) {
        announcementsList.innerHTML = `
          <p style="color: #7c3aed; text-align: center;">
            You are not enrolled in any courses. 
            <a href="/payment" style="color: #a855f7; text-decoration: underline;">
              Enroll in a course
            </a> 
            to view announcements.
          </p>
        `;
        return;
      }

      // Fetch announcements
      const response = await fetch("/api/announcements", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      const result = await response.json();
      if (response.ok) {
        announcementsList.innerHTML = "";
        if (result.announcements && result.announcements.length > 0) {
          result.announcements.forEach((announcement) => {
            const card = document.createElement("div");
            card.className = "announcement-card";
            card.innerHTML = `
              <h3>${announcement.title}</h3>
              <p><strong>Audience:</strong> ${
                audienceDisplayMap[announcement.targetAudience] ||
                announcement.targetAudience
              }</p>
              <p><strong>Type:</strong> ${
                typeDisplayMap[announcement.announcementType] ||
                announcement.announcementType
              }</p>
              <p>${announcement.content}</p>
              <p><small>Posted on ${new Date(
                announcement.createdAt
              ).toLocaleString()}</small></p>
            `;
            announcementsList.appendChild(card);
          });
        } else {
          announcementsList.innerHTML =
            "<p>No announcements available at this time.</p>";
        }
      } else {
        showError(result.message || "Failed to fetch announcements");
        if (
          result.message.includes("token") ||
          result.message.includes("Unauthorized")
        ) {
          localStorage.removeItem("user");
          window.location.href = `/signup?redirect=${encodeURIComponent(
            window.location.pathname
          )}`;
        }
      }
    } catch (error) {
      console.error("Fetch Data Error:", error);
      showError("An error occurred while fetching data");
    } finally {
      if (loadingOverlay) loadingOverlay.style.display = "none";
    }
  }

  // Initial Fetch
  fetchData();
});
