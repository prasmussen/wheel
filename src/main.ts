async function start(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) return;
  try {
    // Import inside the boundary so Wasm compilation failures are recoverable too.
    const { App } = await import("./app/App");
    await new App(root).start();
  } catch (error) {
    console.error("Wheel startup failed", error);
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.textContent = "The wheel could not start. Reload to try again.";
    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "Reload";
    reload.addEventListener("click", () => location.reload());
    root.replaceChildren(message, reload);
  }
}

void start();
