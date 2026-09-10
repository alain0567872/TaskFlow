/* TaskFlow frontend - plain JavaScript + DOM APIs, no framework/build step. */
(function () {
  "use strict";

  const root = document.getElementById("root");

  const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#0ea5e9", "#a855f7"];
  const STATUSES = [
    { key: "todo", label: "To Do" },
    { key: "in_progress", label: "In Progress" },
    { key: "done", label: "Done" },
  ];

  // ------------------------------------------------------------- DOM helpers
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach((key) => {
      if (key === "class") node.className = attrs[key];
      else if (key === "style" && typeof attrs[key] === "object") {
        Object.assign(node.style, attrs[key]);
      } else if (key.startsWith("on") && typeof attrs[key] === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), attrs[key]);
      } else if (key === "html") {
        node.innerHTML = attrs[key];
      } else if (attrs[key] !== undefined && attrs[key] !== null && attrs[key] !== false) {
        node.setAttribute(key, attrs[key]);
      }
    });
    (children || []).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function mount(node) {
    clear(root);
    root.appendChild(node);
  }

  // ----------------------------------------------------------------- state
  const state = {
    token: localStorage.getItem("taskflow_token") || null,
    user: JSON.parse(localStorage.getItem("taskflow_user") || "null"),
    view: { page: "dashboard", projectId: null },
  };

  function setAuth(token, user) {
    state.token = token;
    state.user = user;
    if (token) {
      localStorage.setItem("taskflow_token", token);
      localStorage.setItem("taskflow_user", JSON.stringify(user));
    } else {
      localStorage.removeItem("taskflow_token");
      localStorage.removeItem("taskflow_user");
    }
  }

  // ------------------------------------------------------------------- API
  async function api(path, options) {
    options = options || {};
    const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    if (state.token) headers.Authorization = "Bearer " + state.token;

    const res = await fetch(window.API_BASE_URL + path, Object.assign({}, options, { headers }));
    if (res.status === 401) {
      setAuth(null, null);
      render();
    }
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      body = null;
    }
    if (!res.ok) {
      throw new Error((body && body.error) || "Request failed (" + res.status + ")");
    }
    return body;
  }

  // ------------------------------------------------------------------ toast
  let toastTimer = null;
  function toast(message, type) {
    const existing = document.querySelector(".toast");
    if (existing) existing.remove();
    const node = el("div", { class: "toast" + (type === "error" ? " error" : "") }, [message]);
    document.body.appendChild(node);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.remove(), 3000);
  }

  // ------------------------------------------------------------- Auth screen
  function AuthScreen() {
    let mode = "login"; // or "register"
    let error = "";
    let loading = false;

    function view() {
      const card = el("div", { class: "auth-card" }, [
        el("div", { class: "auth-brand" }, [el("div", { class: "logo-dot" }), el("h1", {}, ["TaskFlow"])]),
        el("p", { class: "subtitle" }, [
          mode === "login" ? "Welcome back. Sign in to your workspace." : "Create your workspace in seconds.",
        ]),
        error ? el("div", { class: "error-banner" }, [error]) : null,
        buildForm(),
        el("div", { class: "switch-mode" }, [
          mode === "login"
            ? el("span", {}, [
                "New here? ",
                el("button", { onClick: () => { mode = "register"; error = ""; rerender(); } }, ["Create an account"]),
              ])
            : el("span", {}, [
                "Already have an account? ",
                el("button", { onClick: () => { mode = "login"; error = ""; rerender(); } }, ["Sign in"]),
              ]),
        ]),
      ]);
      return el("div", { class: "auth-shell" }, [card]);
    }

    function buildForm() {
      const nameInput = el("input", { placeholder: "Ada Lovelace", required: true });
      const emailInput = el("input", { type: "email", placeholder: "you@example.com", required: true });
      const passInput = el("input", { type: "password", placeholder: "At least 6 characters", minlength: 6, required: true });

      const submitBtn = el("button", { class: "btn btn-primary btn-block" }, [
        loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account",
      ]);
      if (loading) submitBtn.setAttribute("disabled", "true");

      const fields = [];
      if (mode === "register") {
        fields.push(el("div", { class: "field" }, [el("label", {}, ["Full name"]), nameInput]));
      }
      fields.push(el("div", { class: "field" }, [el("label", {}, ["Email"]), emailInput]));
      fields.push(el("div", { class: "field" }, [el("label", {}, ["Password"]), passInput]));

      const form = el("form", { onSubmit: onSubmit }, fields.concat([submitBtn]));

      async function onSubmit(e) {
        e.preventDefault();
        error = "";
        loading = true;
        rerender();
        try {
          const path = mode === "login" ? "/auth/login" : "/auth/register";
          const payload =
            mode === "login"
              ? { email: emailInput.value, password: passInput.value }
              : { name: nameInput.value, email: emailInput.value, password: passInput.value };
          const data = await api(path, { method: "POST", body: JSON.stringify(payload) });
          setAuth(data.token, data.user);
          render();
        } catch (err) {
          error = err.message;
          loading = false;
          rerender();
        }
      }

      return form;
    }

    function rerender() {
      mount(view());
    }

    return view();
  }

  // -------------------------------------------------------------- Modal
  function ProjectModal(initial, onClose, onSave) {
    let color = (initial && initial.color) || COLORS[0];
    const nameInput = el("input", { value: (initial && initial.name) || "", placeholder: "Website Redesign", autofocus: true });
    const descInput = el("input", {
      value: (initial && initial.description) || "",
      placeholder: "What is this project about?",
    });

    const swatchWrap = el("div", { class: "swatches" });
    function renderSwatches() {
      clear(swatchWrap);
      COLORS.forEach((c) => {
        const sw = el("div", {
          class: "swatch" + (c === color ? " selected" : ""),
          style: { background: c },
          onClick: () => { color = c; renderSwatches(); },
        });
        swatchWrap.appendChild(sw);
      });
    }
    renderSwatches();

    const form = el(
      "form",
      {
        onSubmit: (e) => {
          e.preventDefault();
          if (!nameInput.value.trim()) return;
          onSave({ name: nameInput.value.trim(), description: descInput.value.trim(), color: color });
        },
      },
      [
        el("div", { class: "field" }, [el("label", {}, ["Name"]), nameInput]),
        el("div", { class: "field" }, [el("label", {}, ["Description"]), descInput]),
        el("div", { class: "field" }, [el("label", {}, ["Color"]), swatchWrap]),
        el("div", { class: "modal-actions" }, [
          el("button", { type: "button", class: "btn btn-ghost", onClick: onClose }, ["Cancel"]),
          el("button", { type: "submit", class: "btn btn-primary" }, ["Save"]),
        ]),
      ]
    );

    const backdrop = el("div", { class: "modal-backdrop", onClick: onClose }, [
      el("div", { class: "modal", onClick: (e) => e.stopPropagation() }, [
        el("h3", {}, [initial ? "Edit project" : "New project"]),
        form,
      ]),
    ]);
    return backdrop;
  }

  // ---------------------------------------------------------------- Topbar
  function Topbar() {
    return el("div", { class: "topbar" }, [
      el("div", { class: "brand" }, [el("div", { class: "logo-dot" }), "TaskFlow"]),
      el("div", { class: "user-area" }, [
        el("span", {}, [state.user.email]),
        el("div", { class: "avatar" }, [state.user.name.slice(0, 1).toUpperCase()]),
        el("button", {
          class: "btn btn-ghost btn-sm",
          onClick: () => { setAuth(null, null); render(); },
        }, ["Log out"]),
      ]),
    ]);
  }

  // -------------------------------------------------------------- Dashboard
  function Dashboard() {
    const container = el("main", { class: "content" });
    const header = el("div", { class: "page-header" }, [
      el("h2", {}, ["Welcome back, " + state.user.name.split(" ")[0]]),
    ]);
    const grid = el("div", { class: "project-grid" }, [el("div", { class: "spinner-wrap" }, ["Loading projects..."])]);
    container.appendChild(header);
    container.appendChild(grid);

    function openProjectModal() {
      const modal = ProjectModal(
        null,
        () => modal.remove(),
        async (payload) => {
          try {
            await api("/projects", { method: "POST", body: JSON.stringify(payload) });
            modal.remove();
            toast("Project created");
            load();
          } catch (e) {
            toast(e.message, "error");
          }
        }
      );
      document.body.appendChild(modal);
    }

    async function deleteProject(id, e) {
      e.stopPropagation();
      if (!window.confirm("Delete this project and all of its tasks?")) return;
      try {
        await api("/projects/" + id, { method: "DELETE" });
        toast("Project deleted");
        load();
      } catch (err) {
        toast(err.message, "error");
      }
    }

    function renderProjects(projects) {
      clear(grid);
      projects.forEach((p) => {
        const pct = p.task_count ? Math.round((p.done_count / p.task_count) * 100) : 0;
        const card = el(
          "div",
          {
            class: "project-card",
            style: { "--card-color": p.color },
            onClick: () => { state.view = { page: "project", projectId: p.id }; render(); },
          },
          [
            el("h3", {}, [p.name]),
            el("p", {}, [p.description || "No description yet."]),
            el("div", { class: "progress-bar" }, [el("div", { style: { width: pct + "%" } })]),
            el("div", { class: "progress-label" }, [
              el("span", {}, [p.done_count + "/" + p.task_count + " done"]),
              el("span", {}, [pct + "%"]),
            ]),
            el("div", { class: "card-actions" }, [
              el("button", { class: "btn btn-danger btn-sm", onClick: (e) => deleteProject(p.id, e) }, ["Delete"]),
            ]),
          ]
        );
        grid.appendChild(card);
      });
      grid.appendChild(
        el("div", { class: "project-card new-project-card", onClick: openProjectModal }, ["+ New project"])
      );
    }

    function load() {
      api("/projects")
        .then((d) => renderProjects(d.projects))
        .catch((e) => toast(e.message, "error"));
    }

    load();
    return container;
  }

  // ------------------------------------------------------------- Task card
  function TaskCard(task, onUpdate, onDelete) {
    const today = new Date().toISOString().slice(0, 10);
    const overdue = task.due_date && task.due_date < today && task.status !== "done";

    const statusSelect = el(
      "select",
      { onChange: (e) => onUpdate(task.id, { status: e.target.value }) },
      STATUSES.map((s) => {
        const opt = el("option", { value: s.key }, [s.label]);
        if (s.key === task.status) opt.setAttribute("selected", "true");
        return opt;
      })
    );

    const meta = [el("span", { class: "badge badge-" + task.priority }, [task.priority])];
    if (task.due_date) {
      meta.push(el("span", { class: "due-date" + (overdue ? " overdue" : "") }, ["Due " + task.due_date]));
    }

    const children = [el("div", { class: "task-title" }, [task.title])];
    if (task.notes) children.push(el("div", { class: "task-notes" }, [task.notes]));
    children.push(el("div", { class: "task-meta" }, meta));
    children.push(
      el("div", { class: "task-card-controls", style: { marginTop: "8px" } }, [
        statusSelect,
        el("button", { class: "btn btn-ghost btn-sm", onClick: () => onDelete(task.id) }, ["Remove"]),
      ])
    );

    return el("div", { class: "task-card" }, children);
  }

  // ---------------------------------------------------------- Project view
  function ProjectView(projectId) {
    const container = el("main", { class: "content" }, [
      el("div", { class: "spinner-wrap" }, ["Loading project..."]),
    ]);

    function load() {
      api("/projects/" + projectId)
        .then((d) => renderProject(d.project))
        .catch((e) => toast(e.message, "error"));
    }

    async function updateTask(taskId, patch) {
      try {
        await api("/tasks/" + taskId, { method: "PUT", body: JSON.stringify(patch) });
        load();
      } catch (err) {
        toast(err.message, "error");
      }
    }

    async function deleteTask(taskId) {
      try {
        await api("/tasks/" + taskId, { method: "DELETE" });
        load();
      } catch (err) {
        toast(err.message, "error");
      }
    }

    function renderProject(project) {
      clear(container);

      const breadcrumb = el("div", { class: "breadcrumb" }, [
        el("button", { onClick: () => { state.view = { page: "dashboard", projectId: null }; render(); } }, ["← All projects"]),
      ]);
      const header = el("div", { class: "page-header" }, [el("h2", { style: { color: project.color } }, [project.name])]);
      container.appendChild(breadcrumb);
      container.appendChild(header);
      if (project.description) {
        container.appendChild(el("p", { style: { color: "var(--text-muted)", marginTop: "-12px" } }, [project.description]));
      }

      const titleInput = el("input", { type: "text", placeholder: "Add a task and press Enter..." });
      const prioritySelect = el("select", {}, [
        el("option", { value: "low" }, ["Low priority"]),
        el("option", { value: "medium", selected: "true" }, ["Medium priority"]),
        el("option", { value: "high" }, ["High priority"]),
      ]);
      const dueInput = el("input", { type: "date" });

      const form = el(
        "form",
        {
          class: "task-input-row",
          onSubmit: async (e) => {
            e.preventDefault();
            if (!titleInput.value.trim()) return;
            try {
              await api("/projects/" + projectId + "/tasks", {
                method: "POST",
                body: JSON.stringify({
                  title: titleInput.value.trim(),
                  priority: prioritySelect.value,
                  due_date: dueInput.value || null,
                }),
              });
              load();
            } catch (err) {
              toast(err.message, "error");
            }
          },
        },
        [titleInput, prioritySelect, dueInput, el("button", { class: "btn btn-primary", type: "submit" }, ["Add task"])]
      );
      container.appendChild(form);

      const grouped = { todo: [], in_progress: [], done: [] };
      (project.tasks || []).forEach((t) => grouped[t.status] && grouped[t.status].push(t));

      const columns = el(
        "div",
        { class: "task-columns" },
        STATUSES.map((col) => {
          const list = grouped[col.key];
          const colNode = el("div", { class: "task-column" }, [
            el("h4", {}, [el("span", {}, [col.label]), el("span", {}, [String(list.length)])]),
          ]);
          if (list.length === 0) {
            colNode.appendChild(el("p", { style: { color: "var(--text-muted)", fontSize: "13px" } }, ["Nothing here."]));
          }
          list.forEach((t) => colNode.appendChild(TaskCard(t, updateTask, deleteTask)));
          return colNode;
        })
      );
      container.appendChild(columns);
    }

    load();
    return container;
  }

  // --------------------------------------------------------------- Router
  function render() {
    if (!state.token || !state.user) {
      mount(AuthScreen());
      return;
    }
    const shell = el("div", { class: "app-shell" }, [Topbar()]);
    shell.appendChild(state.view.page === "dashboard" ? Dashboard() : ProjectView(state.view.projectId));
    mount(shell);
  }

  render();
})();
