import { describe, expect, it, vi } from "vitest";

vi.mock("./icons", () => ({ hydrateIcons: vi.fn() }));

import { createAppController } from "./bootstrap";

class AppDomRoot {
  innerHTML = "";
  workbenchHTML = "";
  private clickHandler: ((event: MouseEvent) => void) | undefined;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "click" && typeof listener === "function") {
      this.clickHandler = listener as (event: MouseEvent) => void;
    }
  }

  querySelector<T extends Element>(selector: string): T | null {
    if (selector !== "[data-app-content]" || !this.innerHTML.includes("data-app-content")) return null;
    const root = this;
    return {
      addEventListener: () => undefined,
      get innerHTML() {
        return root.workbenchHTML;
      },
      set innerHTML(value: string) {
        root.workbenchHTML = value;
      },
    } as unknown as T;
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

describe("application bootstrap", () => {
  it("shows Welcome while authorization is required and never mounts the app shell", async () => {
    const root = new AppDomRoot();
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: async () => ({ state: "unauthenticated", login: null }),
      startGithubLogin: async () => ({ state: "ready", login: "octocat" }),
    }, 1280);

    await controller.start();

    expect(root.innerHTML).toContain('data-startup-state="authorization-required"');
    expect(root.innerHTML).not.toContain('class="app-shell"');
  });

  it("rechecks status after login before rendering Dashboard", async () => {
    const root = new AppDomRoot();
    const status = vi.fn()
      .mockResolvedValueOnce({ state: "unauthenticated", login: null })
      .mockResolvedValueOnce({ state: "ready", login: "octocat" });
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: status,
      startGithubLogin: async () => ({ state: "ready", login: "octocat" }),
    }, 1280);

    await controller.start();
    await controller.authorize();

    expect(status).toHaveBeenCalledTimes(2);
    expect(root.innerHTML).toContain('data-page="dashboard" aria-current="page"');
  });

  it("defers focus revalidation until a pending login confirms ready status", async () => {
    const root = new AppDomRoot();
    let resolveLogin: ((authorization: { state: "ready"; login: string }) => void) | undefined;
    const status = vi.fn()
      .mockResolvedValueOnce({ state: "unauthenticated", login: null })
      .mockResolvedValueOnce({ state: "ready", login: "octocat" });
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: status,
      startGithubLogin: () => new Promise((resolve) => {
        resolveLogin = resolve;
      }),
    }, 1280);

    await controller.start();
    const authorization = controller.authorize();

    await controller.revalidateAuthorization();

    expect(status).toHaveBeenCalledTimes(1);
    expect(root.innerHTML).toContain('data-startup-state="authorizing"');

    resolveLogin?.({ state: "ready", login: "octocat" });
    await authorization;

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
      startGithubLogin: async () => ({ state: "ready", login: "octocat" }),
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
      startGithubLogin: async () => ({ state: "ready", login: "octocat" }),
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
    expect(root.innerHTML).toContain("GitHub authorization was not completed.");
    expect(root.innerHTML).toContain('data-action="authorize-github"');
  });

  it("routes Account reauthorization through a fresh status check", async () => {
    const root = new AppDomRoot();
    const status = vi.fn()
      .mockResolvedValueOnce({ state: "ready", login: "octocat" })
      .mockResolvedValueOnce({ state: "ready", login: "octocat" });
    const login = vi.fn().mockResolvedValue({ state: "ready", login: "octocat" });
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: status,
      startGithubLogin: login,
    }, 1280);

    await controller.start();
    root.clickPage("account");
    root.clickAction("reauthorize");
    await flushDomUpdates();

    expect(login).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledTimes(2);
    expect(root.innerHTML).toContain('data-page="account" aria-current="page"');
    expect(root.workbenchHTML).toContain("@octocat");
  });

  it("switches an expanded sidebar to compact mode at 960 pixels", async () => {
    const root = new AppDomRoot();
    const controller = createAppController(root as unknown as HTMLElement, {
      githubAuthorizationStatus: async () => ({ state: "ready", login: "octocat" }),
      startGithubLogin: async () => ({ state: "ready", login: "octocat" }),
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
      startGithubLogin: async () => ({ state: "ready", login: "octocat" }),
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
      startGithubLogin: async () => ({ state: "ready", login: "octocat" }),
    }, 1280);

    await controller.start();
    root.clickAction("toggle-sidebar");

    expect(root.innerHTML).toContain('data-sidebar-mode="collapsed"');
  });
});
