import { describe, expect, it, vi } from "vitest";

vi.mock("./icons", () => ({ hydrateIcons: vi.fn() }));

const releaseBridge = vi.hoisted(() => ({
  listPublications: vi.fn(),
  retryRelease: vi.fn(),
  rollbackPublication: vi.fn(),
}));

vi.mock("../bridge/releases", () => releaseBridge);

import { createAppController } from "./bootstrap";

class AppDomWorkbench {
  innerHTML = "";
  private clickHandler: ((event: MouseEvent) => void) | undefined;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "click" && typeof listener === "function") {
      this.clickHandler = listener as (event: MouseEvent) => void;
    }
  }

  clickAction(action: string, batchId?: string): void {
    expect(this.innerHTML).toContain(`data-action="${action}"`);
    const dialog = { close: vi.fn() };
    const target = {
      dataset: batchId ? { action, batchId } : { action },
      closest: <T extends HTMLElement>(selector: string): T | null =>
        selector === "[data-action]" ? target as unknown as T : selector === "dialog" ? dialog as unknown as T : null,
    };
    this.clickHandler?.({ target } as unknown as MouseEvent);
  }
}

class AppDomRoot {
  private markup = "";
  workbench = new AppDomWorkbench();
  private clickHandler: ((event: MouseEvent) => void) | undefined;

  get innerHTML(): string {
    return this.markup;
  }

  set innerHTML(value: string) {
    this.markup = value;
    this.workbench = new AppDomWorkbench();
  }

  get workbenchHTML(): string {
    return this.workbench.innerHTML;
  }

  set workbenchHTML(value: string) {
    this.workbench.innerHTML = value;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "click" && typeof listener === "function") {
      this.clickHandler = listener as (event: MouseEvent) => void;
    }
  }

  querySelector<T extends Element>(selector: string): T | null {
    if (selector === "[data-app-content]" && this.innerHTML.includes("data-app-content")) {
      return this.workbench as unknown as T;
    }
    if (selector === ".app-shell" && this.innerHTML.includes('class="app-shell"')) {
      const root = this;
      return {
        setAttribute(name: string, value: string) {
          if (name === "data-sidebar-mode") {
            root.markup = root.markup.replace(/data-sidebar-mode="[^"]*"/, `data-sidebar-mode="${value}"`);
          }
        },
      } as unknown as T;
    }
    if (selector === '[data-action="toggle-sidebar"]') {
      return {
        setAttribute: () => undefined,
        innerHTML: "",
      } as unknown as T;
    }
    return null;
  }

  clickAction(action: string): void {
    expect(`${this.innerHTML}${this.workbenchHTML}`).toContain(`data-action="${action}"`);
    const target = {
      dataset: { action },
      closest: <T extends HTMLElement>(selector: string): T | null =>
        selector === "[data-action]" ? target as unknown as T : null,
    };
    this.clickHandler?.({ target } as unknown as MouseEvent);
  }

  clickPage(page: string): void {
    expect(this.innerHTML).toContain(`data-page="${page}"`);
    const target = {
      dataset: { page },
      closest: <T extends HTMLElement>(selector: string): T | null =>
        selector === "[data-page]" ? target as unknown as T : null,
    };
    this.clickHandler?.({ target } as unknown as MouseEvent);
  }
}

async function flushDomUpdates(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function publishedRecord() {
  return {
    batch_id: "batch-published",
    commit_sha: "published-commit",
    scope_id: "scope-1",
    target_id: "target-1",
    change_ids: ["change-1"],
    state: "published" as const,
    published_at: "2026-09-04T08:00:00Z",
    rollback_commit_sha: null,
    rolled_back_at: null,
  };
}

describe("application bootstrap", () => {
  it("shows Welcome while authorization is required and never mounts the app shell", async () => {
    const root = new AppDomRoot();
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: async () => ({ state: "unauthenticated", login: null }),
      startGithubLogin: async () => ({ state: "started", device_code: "534D-B889" }),
    }, 1280);

    await controller.start();

    expect(root.innerHTML).toContain('data-startup-state="authorization-required"');
    expect(root.innerHTML).toContain('<img class="easyblog-mark" src="/easyblog-mark.png" alt=""');
    expect(root.innerHTML).toContain("EasyBlog");
    expect(root.innerHTML).not.toContain('class="app-shell"');
  });

  it("renders Dashboard only after a browser handoff is confirmed ready", async () => {
    const root = new AppDomRoot();
    const status = vi.fn()
      .mockResolvedValueOnce({ state: "unauthenticated", login: null })
      .mockResolvedValueOnce({ state: "ready", login: "octocat" });
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: status,
      startGithubLogin: async () => ({ state: "started", device_code: "534D-B889" }),
      githubLoginStatus: async () => ({ state: "ready" }),
    }, 1280);

    await controller.start();
    await controller.authorize();

    expect(status).toHaveBeenCalledOnce();
    expect(root.innerHTML).toContain('data-startup-state="awaiting-browser-authorization"');

    await controller.confirmAuthorization();

    expect(status).toHaveBeenCalledTimes(2);
    expect(root.innerHTML).toContain('data-page="dashboard" aria-current="page"');
  });

  it("keeps the Welcome surface actionable while browser authorization is pending", async () => {
    const root = new AppDomRoot();
    const status = vi.fn()
      .mockResolvedValueOnce({ state: "unauthenticated", login: null })
      .mockResolvedValueOnce({ state: "ready", login: "octocat" });
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: status,
      startGithubLogin: async () => ({ state: "started", device_code: "534D-B889" } as never),
    }, 1280);

    await controller.start();
    await controller.authorize();

    expect(status).toHaveBeenCalledOnce();
    expect(root.innerHTML).toContain('data-startup-state="awaiting-browser-authorization"');
    expect(root.innerHTML).toContain('data-action="confirm-authorization"');
    expect(root.innerHTML).toContain("534D-B889");
    expect(root.innerHTML).toContain('data-action="copy-device-code"');
    expect(root.innerHTML).not.toContain('class="app-shell"');
    controller.dispose();
  });

  it("keeps the device-code surface open while GitHub authorization remains pending", async () => {
    vi.useFakeTimers();
    try {
      const root = new AppDomRoot();
      const controller = createAppController(root as unknown as HTMLElement, {
        githubAuthorizationStatus: async () => ({ state: "unauthenticated", login: null }),
        startGithubLogin: async () => ({ state: "started", device_code: "534D-B889" }),
      }, 1280);

      await controller.start();
      await controller.authorize();
      await vi.advanceTimersByTimeAsync(120_000);

      expect(root.innerHTML).toContain('data-startup-state="awaiting-browser-authorization"');
      expect(root.innerHTML).toContain("534D-B889");
      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not treat a previous GitHub login as completion of a fresh authorization", async () => {
    vi.useFakeTimers();
    try {
      const root = new AppDomRoot();
      const status = vi.fn()
        .mockResolvedValueOnce({ state: "unauthenticated", login: null })
        .mockResolvedValueOnce({ state: "ready", login: "octocat" });
      const controller = createAppController(root as unknown as HTMLElement, {
        githubAuthorizationStatus: status,
        startGithubLogin: async () => ({ state: "started", device_code: "534D-B889" }),
        githubLoginStatus: async () => ({ state: "pending", message: null }),
      } as Parameters<typeof createAppController>[1], 1280);

      await controller.start();
      await controller.authorize();
      await vi.advanceTimersByTimeAsync(2_000);

      expect(root.innerHTML).toContain('data-startup-state="awaiting-browser-authorization"');
      expect(root.innerHTML).toContain("534D-B889");
      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops browser authorization polling after confirmation and disposal", async () => {
    vi.useFakeTimers();
    try {
      const root = new AppDomRoot();
      const status = vi.fn()
        .mockResolvedValueOnce({ state: "unauthenticated", login: null })
        .mockResolvedValueOnce({ state: "ready", login: "octocat" });
      const controller = createAppController(root as unknown as HTMLElement, {
        githubAuthorizationStatus: status,
        startGithubLogin: async () => ({ state: "started", device_code: "534D-B889" }),
        githubLoginStatus: async () => ({ state: "ready" }),
      }, 1280);

      await controller.start();
      await controller.authorize();
      await vi.advanceTimersByTimeAsync(2_000);

      expect(status).toHaveBeenCalledTimes(2);
      expect(root.innerHTML).toContain('class="app-shell"');

      await vi.advanceTimersByTimeAsync(4_000);
      expect(status).toHaveBeenCalledTimes(2);

      const pendingRoot = new AppDomRoot();
      const pendingStatus = vi.fn().mockResolvedValue({ state: "unauthenticated", login: null });
      const pendingController = createAppController(pendingRoot as unknown as HTMLElement, {
        githubAuthorizationStatus: pendingStatus,
        startGithubLogin: async () => ({ state: "started", device_code: "534D-B889" }),
      }, 1280);

      await pendingController.start();
      await pendingController.authorize();
      pendingController.dispose();
      await vi.advanceTimersByTimeAsync(4_000);

      expect(pendingStatus).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("defers focus revalidation until a pending login confirms ready status", async () => {
    const root = new AppDomRoot();
    let resolveLogin: ((launch: { state: "started"; device_code: string }) => void) | undefined;
    const status = vi.fn()
      .mockResolvedValueOnce({ state: "unauthenticated", login: null })
      .mockResolvedValueOnce({ state: "ready", login: "octocat" });
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: status,
      startGithubLogin: () => new Promise((resolve) => {
        resolveLogin = resolve;
      }),
      githubLoginStatus: async () => ({ state: "ready" }),
    }, 1280);

    await controller.start();
    const authorization = controller.authorize();

    await controller.revalidateAuthorization();

    expect(status).toHaveBeenCalledTimes(1);
    expect(root.innerHTML).toContain('data-startup-state="authorizing"');

    resolveLogin?.({ state: "started", device_code: "534D-B889" });
    await authorization;

    expect(status).toHaveBeenCalledOnce();
    expect(root.innerHTML).toContain('data-startup-state="awaiting-browser-authorization"');

    await controller.confirmAuthorization();

    expect(status).toHaveBeenCalledTimes(2);
    expect(root.innerHTML).toContain('data-page="dashboard" aria-current="page"');
  });

  it("returns from a ready shell to Welcome after a later non-ready check", async () => {
    const root = new AppDomRoot();
    const status = vi.fn()
      .mockResolvedValueOnce({ state: "ready", login: "octocat" })
      .mockResolvedValueOnce({ state: "unauthenticated", login: null });
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: status,
      startGithubLogin: async () => ({ state: "started", device_code: "534D-B889" }),
    }, 1280);

    await controller.start();
    await controller.revalidateAuthorization();

    expect(root.innerHTML).toContain('data-startup-state="authorization-required"');
    expect(root.innerHTML).not.toContain('class="app-shell"');
  });

  it("renders an error retry surface when the authorization status check rejects", async () => {
    const root = new AppDomRoot();
    const status = vi.fn()
      .mockRejectedValueOnce(new Error("bridge unavailable"))
      .mockResolvedValueOnce({ state: "ready", login: "octocat" });
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: status,
      startGithubLogin: async () => ({ state: "started", device_code: "534D-B889" }),
    }, 1280);

    await controller.start();

    expect(root.innerHTML).toContain('data-startup-state="error"');
    expect(root.innerHTML).toContain('data-action="retry-authorization"');

    root.clickAction("retry-authorization");
    await flushDomUpdates();

    expect(root.innerHTML).toContain('data-page="dashboard" aria-current="page"');
  });

  it("returns to Welcome with a retryable message when GitHub login rejects", async () => {
    const root = new AppDomRoot();
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: async () => ({ state: "unauthenticated", login: null }),
      startGithubLogin: async () => Promise.reject(new Error("login cancelled")),
    }, 1280);

    await controller.start();
    await controller.authorize();

    expect(root.innerHTML).toContain('data-startup-state="authorization-required"');
    expect(root.innerHTML).toContain("无法打开 GitHub 授权，请重试。");
    expect(root.innerHTML).toContain('data-action="authorize-github"');
  });

  it("routes Account reauthorization through a fresh status check", async () => {
    const root = new AppDomRoot();
    const status = vi.fn()
      .mockResolvedValueOnce({ state: "ready", login: "octocat" })
      .mockResolvedValueOnce({ state: "ready", login: "octocat" });
    const login = vi.fn().mockResolvedValue({ state: "started", device_code: "534D-B889" });
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: status,
      startGithubLogin: login,
    }, 1280);

    await controller.start();
    root.clickPage("account");
    root.clickAction("reauthorize");
    await flushDomUpdates();

    expect(login).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledOnce();
    expect(root.innerHTML).toContain('data-startup-state="awaiting-browser-authorization"');
    controller.dispose();
  });

  it("switches an expanded sidebar to compact mode at 960 pixels", async () => {
    const root = new AppDomRoot();
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: async () => ({ state: "ready", login: "octocat" }),
      startGithubLogin: async () => ({ state: "started", device_code: "534D-B889" }),
    }, 1280);

    await controller.start();
    expect(root.innerHTML).toContain('data-sidebar-mode="expanded"');

    controller.setViewportWidth(960);
    expect(root.innerHTML).toContain('data-sidebar-mode="collapsed"');
  });

  it("switches an expanded sidebar to compact mode at the 1000 pixel boundary", async () => {
    const root = new AppDomRoot();
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: async () => ({ state: "ready", login: "octocat" }),
      startGithubLogin: async () => ({ state: "started", device_code: "534D-B889" }),
    }, 1001);

    await controller.start();
    expect(root.innerHTML).toContain('data-sidebar-mode="expanded"');

    controller.setViewportWidth(1000);
    expect(root.innerHTML).toContain('data-sidebar-mode="collapsed"');
  });

  it("routes sidebar toggles through the shell state", async () => {
    const root = new AppDomRoot();
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: async () => ({ state: "ready", login: "octocat" }),
      startGithubLogin: async () => ({ state: "started", device_code: "534D-B889" }),
    }, 1280);

    await controller.start();
    root.clickAction("toggle-sidebar");

    expect(root.innerHTML).toContain('data-sidebar-mode="collapsed"');
  });

  it("preserves the mounted editor workbench across safe shell updates", async () => {
    const root = new AppDomRoot();
    const status = vi.fn().mockResolvedValue({ state: "ready", login: "octocat" });
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: status,
      startGithubLogin: async () => ({ state: "started", device_code: "534D-B889" }),
    }, 1280);

    await controller.start();
    const editorWorkbench = root.workbench;
    root.workbenchHTML = '<input name="scope-name" value="Unsaved draft" />';

    controller.setViewportWidth(960);
    root.clickAction("toggle-sidebar");
    await controller.revalidateAuthorization();

    expect(root.workbench).toBe(editorWorkbench);
    expect(root.workbenchHTML).toContain('value="Unsaved draft"');
  });

  it.each([
    ["a resize", (controller: ReturnType<typeof createAppController>, _root: AppDomRoot) => controller.setViewportWidth(960)],
    ["a sidebar toggle", (controller: ReturnType<typeof createAppController>, root: AppDomRoot) => root.clickAction("toggle-sidebar")],
    ["ready-state revalidation", (controller: ReturnType<typeof createAppController>, _root: AppDomRoot) => controller.revalidateAuthorization()],
  ])("keeps a pending rollback guarded through %s", async (_label, trigger) => {
    releaseBridge.listPublications.mockReset();
    releaseBridge.retryRelease.mockReset();
    releaseBridge.rollbackPublication.mockReset();
    releaseBridge.listPublications.mockResolvedValue([publishedRecord()]);
    let resolveRollback!: (value: string) => void;
    releaseBridge.rollbackPublication.mockImplementation(() => new Promise<string>((resolve) => {
      resolveRollback = resolve;
    }));

    const root = new AppDomRoot();
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: async () => ({ state: "ready", login: "octocat" }),
      startGithubLogin: async () => ({ state: "started", device_code: "534D-B889" }),
    }, 1280);

    await controller.start();
    controller.navigate("history");
    await flushDomUpdates();
    root.workbench.clickAction("confirm-rollback", "batch-published");

    await trigger(controller, root);
    await flushDomUpdates();
    root.workbench.clickAction("confirm-rollback", "batch-published");

    expect(releaseBridge.rollbackPublication).toHaveBeenCalledOnce();
    resolveRollback("reverse-commit");
  });
});
