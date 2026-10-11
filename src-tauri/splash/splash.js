// The desktop shell's own page while the FITRON server starts. It talks to nothing: the shell calls fitronStartFailed()
// when the server cannot start, and otherwise replaces this page with FITRON itself.
setTimeout(() => {
  const slow = document.getElementById("slow");
  if (slow) slow.hidden = false;
}, 8000);

window.fitronStartFailed = (reason, log) => {
  document.getElementById("starting").hidden = true;
  document.getElementById("reason").textContent = reason;
  document.getElementById("log").textContent = log;
  document.getElementById("failed").hidden = false;
};
