export function showToast(message: string, type: "success" | "error" | "info" = "info"): void {
  const el = document.createElement("div");
  el.className = `hc-toast hc-toast-${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 3000);
}
