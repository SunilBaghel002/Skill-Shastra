document.addEventListener("DOMContentLoaded", () => {
  const announcementForm = document.getElementById("announcementForm");
  const announcementsList = document.getElementById("announcements");
  const errorMessage = document.getElementById("errorMessage");
  const successMessage = document.getElementById("successMessage");
  const submitButton = document.getElementById("submitButton");
  const loadingOverlay = document.getElementById("loading-overlay");

  // Map targetAudience values to display names
  const audienceDisplayMap = {
    all: "All Users",
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
    "DSA": "DSA",
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

  // Toggle Loading State for Submit Button
  function toggleSubmitLoading(isLoading) {
    if (submitButton) {
      submitButton.disabled = isLoading;
      submitButton.classList.toggle("loading", isLoading);
    }
  }

  // Fetch Announcements
  async function fetchAnnouncements() {
    if (loadingOverlay) loadingOverlay.style.display = "flex";
    try {
      const response = await fetch("/api/admin/announcements", {
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
              <p><small>Posted by ${
                announcement.createdBy?.name || "Unknown"
              } on ${new Date(
              announcement.createdAt
            ).toLocaleString()}</small></p>
              <div class="actions">
                <button class="btn btn-edit" onclick="editAnnouncement('${
                  announcement._id
                }')">Edit</button>
                <button class="btn btn-delete" onclick="deleteAnnouncement('${
                  announcement._id
                }')">Delete</button>
              </div>
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
          result.message.includes("Unauthorized") ||
          result.message.includes("Admin only")
        ) {
          localStorage.removeItem("user");
          window.location.href = `/signup?redirect=${encodeURIComponent(
            window.location.pathname
          )}`;
        }
      }
    } catch (error) {
      console.error("Fetch Announcements Error:", error);
      showError("An error occurred while fetching announcements");
    } finally {
      if (loadingOverlay) loadingOverlay.style.display = "none";
    }
  }

  // Post Announcement
  if (announcementForm) {
    announcementForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("title")?.value.trim();
      const content = document.getElementById("content")?.value; // Do not trim content
      const targetAudience = document.getElementById("targetAudience")?.value;
      const announcementType =
        document.getElementById("announcementType")?.value;

      if (!title || !content || !targetAudience || !announcementType) {
        showError("All fields are required");
        return;
      }

      toggleSubmitLoading(true);
      try {
        const response = await fetch("/api/admin/announcements", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            title,
            content,
            targetAudience,
            announcementType,
          }),
        });

        const result = await response.json();
        if (response.ok) {
          showSuccess("Announcement posted successfully");
          announcementForm.reset();
          fetchAnnouncements();
        } else {
          showError(result.message || "Failed to post announcement");
          if (
            result.message.includes("token") ||
            result.message.includes("Unauthorized") ||
            result.message.includes("Admin only")
          ) {
            localStorage.removeItem("user");
            window.location.href = `/signup?redirect=${encodeURIComponent(
              window.location.pathname
            )}`;
          }
        }
      } catch (error) {
        console.error("Post Announcement Error:", error);
        showError("An error occurred while posting the announcement");
      } finally {
        toggleSubmitLoading(false);
      }
    });
  }

  // Edit Announcement
  window.editAnnouncement = async (id) => {
    try {
      const response = await fetch(`/api/admin/announcements`, {
        method: "GET",
        credentials: "include",
      });
      const result = await response.json();
      if (response.ok) {
        const announcement = result.announcements.find((a) => a._id === id);
        if (announcement) {
          const titleInput = document.getElementById("title");
          const contentInput = document.getElementById("content");
          const targetAudienceInput = document.getElementById("targetAudience");
          const announcementTypeInput =
            document.getElementById("announcementType");

          if (
            !titleInput ||
            !contentInput ||
            !targetAudienceInput ||
            !announcementTypeInput
          ) {
            showError("Form elements are missing. Please refresh the page.");
            return;
          }

          titleInput.value = announcement.title;
          contentInput.value = announcement.content; // Preserve original content
          targetAudienceInput.value = announcement.targetAudience;
          announcementTypeInput.value = announcement.announcementType;

          announcementForm.onsubmit = async (e) => {
            e.preventDefault();
            const title = titleInput.value.trim();
            const content = contentInput.value; // Do not trim content
            const targetAudience = targetAudienceInput.value;
            const announcementType = announcementTypeInput.value;

            toggleSubmitLoading(true);
            try {
              const updateResponse = await fetch(
                `/api/admin/announcements/${id}`,
                {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  credentials: "include",
                  body: JSON.stringify({
                    title,
                    content,
                    targetAudience,
                    announcementType,
                  }),
                }
              );

              const updateResult = await updateResponse.json();
              if (updateResponse.ok) {
                showSuccess("Announcement updated successfully");
                announcementForm.reset();
                announcementForm.onsubmit = null; // Reset to default form submission
                fetchAnnouncements();
              } else {
                showError(
                  updateResult.message || "Failed to update announcement"
                );
                if (
                  updateResult.message.includes("token") ||
                  updateResult.message.includes("Unauthorized") ||
                  updateResult.message.includes("Admin only")
                ) {
                  localStorage.removeItem("user");
                  window.location.href = `/signup?redirect=${encodeURIComponent(
                    window.location.pathname
                  )}`;
                }
              }
            } catch (error) {
              console.error("Update Announcement Error:", error);
              showError("An error occurred while updating the announcement");
            } finally {
              toggleSubmitLoading(false);
            }
          };
        } else {
          showError("Announcement not found");
        }
      } else {
        showError(result.message || "Failed to fetch announcement details");
        if (
          result.message.includes("token") ||
          result.message.includes("Unauthorized") ||
          result.message.includes("Admin only")
        ) {
          localStorage.removeItem("user");
          window.location.href = `/signup?redirect=${encodeURIComponent(
            window.location.pathname
          )}`;
        }
      }
    } catch (error) {
      console.error("Edit Announcement Error:", error);
      showError("An error occurred while editing the announcement");
    }
  };

  // Delete Announcement
  window.deleteAnnouncement = async (id) => {
    if (confirm("Are you sure you want to delete this announcement?")) {
      if (loadingOverlay) loadingOverlay.style.display = "flex";
      try {
        const response = await fetch(`/api/admin/announcements/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
        const result = await response.json();
        if (response.ok) {
          showSuccess("Announcement deleted successfully");
          fetchAnnouncements();
        } else {
          showError(result.message || "Failed to delete announcement");
          if (
            result.message.includes("token") ||
            result.message.includes("Unauthorized") ||
            result.message.includes("Admin only")
          ) {
            localStorage.removeItem("user");
            window.location.href = `/signup?redirect=${encodeURIComponent(
              window.location.pathname
            )}`;
          }
        }
      } catch (error) {
        console.error("Delete Announcement Error:", error);
        showError("An error occurred while deleting the announcement");
      } finally {
        if (loadingOverlay) loadingOverlay.style.display = "none";
      }
    }
  };

  // Initial Fetch
  fetchAnnouncements();
});
