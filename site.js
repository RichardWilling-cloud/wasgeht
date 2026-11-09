// Static pages (event, date, genre and venue pages): replace event images that fail
// to load with the designed text poster, like the homepage does.
(() => {
  "use strict";
  const fallback = (image) => {
    image.closest(".event-poster")?.classList.remove("has-image");
    image.remove();
  };
  // Capture phase: image errors do not bubble.
  document.addEventListener("error", (event) => {
    if (event.target instanceof HTMLImageElement && event.target.classList.contains("event-poster-image")) fallback(event.target);
  }, true);
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("img.event-poster-image").forEach((image) => {
      if (image.complete && image.naturalWidth === 0) fallback(image);
    });
  });
})();
