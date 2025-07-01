const API_URL = "http://localhost:5000/api";

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

async function fetchAnnouncements(isAdmin = false) {
  try {
    const endpoint = isAdmin ? "/admin/announcements" : "/announcements";
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    const data = await response.json();

    if (response.ok) {
      renderAnnouncements(data.announcements, isAdmin);
    } else {
      showError(data.message || "Failed to fetch announcements.");
    }
  } catch (error) {
    showError("Network error while fetching announcements.");
    console.error("Fetch Announcements Error:", error);
  }
}

function renderAnnouncements(announcements, isAdmin) {
  const container = document.getElementById("announcements");
  if (!container) return;

  container.innerHTML = "";
  if (announcements.length === 0) {
    container.innerHTML = "<p>No announcements available.</p>";
    return;
  }

  announcements.forEach((announcement) => {
    const card = document.createElement("div");
    card.className = "announcement-card";
    card.innerHTML = `
      <h3>${announcement.title}</h3>
      <p><strong>Type:</strong> ${announcement.announcementType.replace(
        "_",
        " "
      )}</p>
      <p><strong>Audience:</strong> ${
        announcement.targetAudience === "all"
          ? "All Users"
          : announcement.targetAudience.replace("-", " ")
      }</p>
      <p>${announcement.content}</p>
      <p><small>Posted on ${new Date(
        announcement.createdAt
      ).toLocaleString()}</small></p>
      ${
        isAdmin
          ? `
        <p><strong>Created By:</strong> ${announcement.createdBy.name} (${announcement.createdBy.email})</p>
        <div class="actions">
          <button class="btn btn-edit" onclick="editAnnouncement('${announcement._id}')">Edit</button>
          <button class="btn btn-delete" onclick="deleteAnnouncement('${announcement._id}')">Delete</button>
        </div>
      `
          : ""
      }
    `;
    container.appendChild(card);
  });
}

document
  .getElementById("announcementForm")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("title")?.value.trim();
    const content = document.getElementById("content")?.value.trim();
    const targetAudience = document.getElementById("targetAudience")?.value;
    const announcementType = document.getElementById("announcementType")?.value;
    const submitBtn = e.target.querySelector("button[type='submit']");
    const originalText = "Post Announcement";

    if (
      !title ||
      !content ||
      !targetAudience ||
      !announcementType ||
      !submitBtn
    ) {
      showError("All fields are required.");
      return;
    }

    if (title.length > 100) {
      showError("Heading must be 100 characters or less.");
      return;
    }

    if (content.length > 1000) {
      showError("Content must be 1000 characters or less.");
      return;
    }

    disableButton(submitBtn);

    try {
      const response = await fetch(`${API_URL}/admin/announcements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title,
          content,
          targetAudience,
          announcementType,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        showSuccess("Announcement posted successfully!");
        document.getElementById("announcementForm").reset();
        fetchAnnouncements(true);
      } else {
        showError(data.message || "Failed to post announcement.");
      }
    } catch (error) {
      showError("Network error while posting announcement.");
      console.error("Post Announcement Error:", error);
    } finally {
      enableButton(submitBtn, originalText);
    }
  });

async function editAnnouncement(id) {
  try {
    const response = await fetch(`${API_URL}/admin/announcements`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    const data = await response.json();

    if (response.ok) {
      const announcement = data.announcements.find((a) => a._id === id);
      if (!announcement) {
        showError("Announcement not found.");
        return;
      }

      document.getElementById("title").value = announcement.title;
      document.getElementById("content").value = announcement.content;
      document.getElementById("targetAudience").value =
        announcement.targetAudience;
      document.getElementById("announcementType").value =
        announcement.announcementType;

      const form = document.getElementById("announcementForm");
      const submitBtn = form.querySelector("button[type='submit']");
      submitBtn.textContent = "Update Announcement";
      submitBtn.onclick = async (e) => {
        e.preventDefault();
        const title = document.getElementById("title")?.value.trim();
        const content = document.getElementById("content")?.value.trim();
        const targetAudience = document.getElementById("targetAudience")?.value;
        const announcementType =
          document.getElementById("announcementType")?.value;

        if (!title || !content || !targetAudience || !announcementType) {
          showError("All fields are required.");
          return;
        }

        try {
          const updateResponse = await fetch(
            `${API_URL}/admin/announcements/${id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                title,
                content,
                targetAudience,
                announcementType,
              }),
            }
          );

          const updateData = await updateResponse.json();

          if (updateResponse.ok) {
            showSuccess("Announcement updated successfully!");
            form.reset();
            submitBtn.textContent = "Post Announcement";
            submitBtn.onclick = null;
            fetchAnnouncements(true);
          } else {
            showError(updateData.message || "Failed to update announcement.");
          }
        } catch (error) {
          showError("Network error while updating announcement.");
          console.error("Update Announcement Error:", error);
        }
      };
    } else {
      showError(data.message || "Failed to fetch announcement.");
    }
  } catch (error) {
    showError("Network error while fetching announcement.");
    console.error("Edit Announcement Error:", error);
  }
}

async function deleteAnnouncement(id) {
  if (!confirm("Are you sure you want to delete this announcement?")) return;

  try {
    const response = await fetch(`${API_URL}/admin/announcements/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });

    const data = await response.json();

    if (response.ok) {
      showSuccess("Announcement deleted successfully!");
      fetchAnnouncements(true);
    } else {
      showError(data.message || "Failed to delete announcement.");
    }
  } catch (error) {
    showError("Network error while deleting announcement.");
    console.error("Delete Announcement Error:", error);
  }
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  const isAdmin = window.location.pathname.includes("/admin");
  fetchAnnouncements(isAdmin);
});
