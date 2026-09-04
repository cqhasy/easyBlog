export function renderSettings(): string {
  return `<section class="settings-page" aria-labelledby="settings-title">
    <header>
      <p class="eyebrow">应用设置</p>
      <h1 id="settings-title">设置</h1>
    </header>
    <dl class="settings-rows">
      <div><dt>应用版本</dt><dd>EasyBlog 0.1.0</dd></div>
      <div><dt>检测方式</dt><dd>手动检查</dd></div>
      <div><dt>外观</dt><dd>跟随系统</dd></div>
      <div><dt>诊断</dt><dd>诊断暂不可用</dd></div>
    </dl>
  </section>`;
}
