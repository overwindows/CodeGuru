(function () {
  const taskSelect = document.getElementById("task-select");
  const codeInput = document.getElementById("code-input");
  const runButton = document.getElementById("run-task");
  const resultEl = document.getElementById("legacy-result");

  runButton.addEventListener("click", async () => {
    const task = taskSelect.value;
    const code = codeInput.value.trim();

    if (!code) {
      resultEl.textContent = "Please paste some code first.";
      return;
    }

    runButton.disabled = true;
    resultEl.textContent = "Running…";

    try {
      const response = await fetch("/api/legacy/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, code }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
      }

      resultEl.textContent = data.result || "(empty response)";
    } catch (error) {
      resultEl.innerHTML = `<span class="error-text">${error.message || String(error)}</span>`;
    } finally {
      runButton.disabled = false;
    }
  });
})();
