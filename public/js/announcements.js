document.addEventListener("DOMContentLoaded", () => {
  const announcementForm = document.getElementById("announcementForm");
  const announcementsList = document.getElementById("announcements");
  const errorMessage = document.getElementById("errorMessage");
  const successMessage = document.getElementById("successMessage");

  // Map targetAudience values to display names
  const audienceDisplayMap = {
    all: "All Users",
    frontend: "Frontend Development",
    backend: "Backend Development",
    "full-stack": "Full Stack Development",
    "digital-marketing": "Digital Marketing",
    "data-science": "Data Science",
  };

  // Map announcement types to display names
  const typeDisplayMap = {
    general: "General",
    class_schedule: "Class Schedule",
    test: "Test",
    event: "Event",
  };

  // Fetch Announcements
  async function fetchAnnouncements() {
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
            <p><small>Posted by ${announcement.createdBy.name} on ${new Date(
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
        showError(result.message || "Failed to fetch announcements");
      }
    } catch (error) {
      console.error("Fetch Announcements Error:", error);
      showError("An error occurred while fetching announcements");
    }
  }

  // Post Announcement
  announcementForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("title").value.trim();
    const content = document.getElementById("content").value.trim();
    const targetAudience = document.getElementById("targetAudience").value;
    const announcementType = document.getElementById("announcementType").value;

    if (!title || !content || !targetAudience || !announcementType) {
      showError("All fields are required");
      return;
    }

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
          result.message.includes("Unauthorized")
        ) {
          console.log(`API error: ${result.message}, redirecting to /signup`);
          localStorage.removeItem("user");
          window.location.href = `/signup?redirect=${encodeURIComponent(
            window.location.pathname
          )}`;
        }
      }
    } catch (error) {
      console.error("Post Announcement Error:", error);
      showError("An error occurred while posting the announcement");
    }
  });

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
          document.getElementById("title").value = announcement.title;
          document.getElementById("content").value = announcement.content;
          document.getElementById("targetAudience").value =
            announcement.targetAudience;
          document.getElementById("announcementType").value =
            announcement.announcementType;

          announcementForm.onsubmit = async (e) => {
            e.preventDefault();
            const title = document.getElementById("title").value.trim();
            const content = document.getElementById("content").value.trim();
            const targetAudience =
              document.getElementById("targetAudience").value;
            const announcementType =
              document.getElementById("announcementType").value;

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
              }
            } catch (error) {
              console.error("Update Announcement Error:", error);
              showError("An error occurred while updating the announcement");
            }
          };
        }
      } else {
        showError(result.message || "Failed to fetch announcement details");
      }
    } catch (error) {
      console.error("Edit Announcement Error:", error);
      showError("An error occurred while editing the announcement");
    }
  };

  // Delete Announcement
  window.deleteAnnouncement = async (id) => {
    if (confirm("Are you sure you want to delete this announcement?")) {
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
        }
      } catch (error) {
        console.error("Delete Announcement Error:", error);
        showError("An error occurred while deleting the announcement");
      }
    }
  };

  // Show Error Message
  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = "block";
    successMessage.style.display = "none";
    setTimeout(() => (errorMessage.style.display = "none"), 5000);
  }

  // Show Success Message
  function showSuccess(message) {
    successMessage.textContent = message;
    successMessage.style.display = "block";
    errorMessage.style.display = "none";
    setTimeout(() => (successMessage.style.display = "none"), 5000);
  }

  // Initial Fetch
  fetchAnnouncements();
});
