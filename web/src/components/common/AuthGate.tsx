import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Ghost, KeyRound, LifeBuoy, Mail, ShieldCheck, UserRound, X } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { RecoveryChannel, RecoveryChannelState, RecoveryResult } from '@/api/types';
import { PasswordInput } from '@/components/common/PasswordInput';
import { PasswordStrength } from '@/components/common/PasswordStrength';
import { assessPassword } from '@/lib/password';
import { loadRemembered, saveRemembered } from '@/lib/remember';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import { useAuth } from '@/store/auth';
import { useSite } from '@/store/site';
import { useUi } from '@/store/ui';

/** 找回密码的四种渠道：邮箱与密保为预留能力，客服与站长为真实可用渠道 */
const RECOVERY_METHODS = [
  { key: 'email', label: '邮箱找回', icon: Mail, desc: '通过绑定的邮箱自助重置密码' },
  { key: 'service', label: '站内客服', icon: LifeBuoy, desc: '给站内客服留言，核实身份后协助重置' },
  { key: 'master', label: '站长求助', icon: UserRound, desc: '联系不上客服时可直接向站长求助' },
  { key: 'security', label: '密保找回', icon: KeyRound, desc: '通过密保问题找回' },
] as const;

function formatCountdown(seconds: number) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function AuthGate() {
  const gate = useUi((s) => s.authGate);
  const closeAuth = useUi((s) => s.closeAuth);
  const openAuth = useUi((s) => s.openAuth);
  const notify = useUi((s) => s.notify);
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);
  const guestLogin = useAuth((s) => s.guestLogin);
  const cancelAuth = useAuth((s) => s.cancelAuth);
  const busy = useAuth((s) => s.busy);
  const securing = useAuth((s) => s.securing);
  const siteConfig = useSite((s) => s.config);
  const loadSite = useSite((s) => s.load);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [realName, setRealName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [error, setError] = useState('');
  const [lockUntil, setLockUntil] = useState(0);
  const [remaining, setRemaining] = useState(0);
  /* 记住账号 / 记住密码（仅登录模式，默认关闭） */
  const [rememberAccount, setRememberAccount] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);
  /* 找回密码 */
  const [recoverAccount, setRecoverAccount] = useState('');
  const [recovering, setRecovering] = useState('');
  const [recoverResult, setRecoverResult] = useState<{
    message: string;
    channel: RecoveryChannel;
    requestId?: number;
    tone: 'ok' | 'warn';
  } | null>(null);

  /** 清空全部输入：关弹窗与切换登录/注册/找回都从这里走，保证不残留上一次的内容 */
  const resetForm = () => {
    setUsername('');
    setPassword('');
    setConfirm('');
    setNickname('');
    setEmail('');
    setPhone('');
    setRealName('');
    setIdNumber('');
    setHoneypot('');
    setError('');
    setRecoverResult(null);
  };

  useEffect(() => {
    if (!gate) return;
    resetForm();
    /* 每次打开弹窗都重新拉一次站点配置：
       管理员刚开启的开关（访客登录、邮箱/实名、找回渠道）无需刷新页面就能生效 */
    loadSite();

    /* 登录模式回填「记住」的内容；注册与找回模式不预填任何凭据 */
    if (gate === 'login') {
      const saved = loadRemembered();
      setUsername(saved.username);
      setPassword(saved.password);
      setRememberAccount(saved.rememberAccount);
      setRememberPassword(saved.rememberPassword);
    } else {
      setRememberAccount(false);
      setRememberPassword(false);
    }
  }, [gate, loadSite]);

  /* 弹窗打开时锁住页面滚动，避免「弹窗还在，背景页面被滑走」 */
  useBodyScrollLock(Boolean(gate));

  /**
   * 关闭弹窗：先撤销在途认证请求（复位按钮与进度），再清空表单。
   * 否则登录请求还在飞的时候关掉，再打开会看到按钮仍卡在「处理中」。
   */
  const dismiss = () => {
    cancelAuth();
    setRecovering('');
    resetForm();
    closeAuth();
  };

  /* 被锁定时给出明确倒计时，避免用户反复点击把锁定时间越推越长 */
  useEffect(() => {
    if (!lockUntil) {
      setRemaining(0);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) setLockUntil(0);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [lockUntil]);

  const locked = remaining > 0;
  /*
   * 只报「正在做什么」，不把内部哈希尝试次数摊给用户：
   * 那个数字既让人误以为在反复失败重试，也等于把安全参数告诉了攻击者。
   */
  const busyLabel = useMemo(() => {
    if (locked) return `安全锁定 ${formatCountdown(remaining)}`;
    if (securing > 0) return '正在完成安全校验…';
    if (busy) return '处理中…';
    return '';
  }, [locked, remaining, securing, busy]);

  /* 校验确实偏慢时才补一句解释，避免用户以为卡住了 */
  const [slowHint, setSlowHint] = useState(false);
  useEffect(() => {
    if (!busy) {
      setSlowHint(false);
      return;
    }
    const timer = window.setTimeout(() => setSlowHint(true), 2500);
    return () => window.clearTimeout(timer);
  }, [busy]);

  /*
   * 密码强度只提示不拦截：达到最小长度即可提交，普通密码同样放行。
   * 必须放在下面的提前 return 之前——Hook 一旦被条件跳过，
   * 弹窗打开时 Hook 数量变化会让 React 直接卸载整棵树（表现为黑屏）。
   */
  const passwordAssessment = useMemo(
    () => assessPassword(password, { minLength: siteConfig.minPasswordLength, username: username.trim() }),
    [password, siteConfig.minPasswordLength, username]
  );

  if (!gate) return null;

  const isRegister = gate === 'register';
  const isRecover = gate === 'recover';
  const registerBlocked = isRegister && !siteConfig.allowRegister;
  /* 预留的验证开关：只在超级管理员开启后才展示对应输入框 */
  const verification = siteConfig.verification;

  const readFailure = (err: unknown, fallback: string) => {
    if (err instanceof ApiError) {
      setError(err.message);
      const retryAfter = Number((err.payload as { retryAfter?: number } | null)?.retryAfter || 0);
      if (retryAfter > 0 && (err.status === 423 || err.status === 401 || err.status === 429)) {
        setLockUntil(Date.now() + retryAfter * 1000);
      }
      return;
    }
    setError(err instanceof Error && err.message ? err.message : fallback);
  };

  const enterAsGuest = async () => {
    setError('');
    try {
      await guestLogin(honeypot);
      notify('已以访客身份进入，本次访问已被记录', 'success');
      dismiss();
    } catch (err) {
      readFailure(err, '访客进入失败，请稍后再试');
    }
  };

  /** 渠道的实时可用性：与后端 recoveryChannelState 判定一致，用于提前禁用走不通的入口 */
  const channelState = (key: (typeof RECOVERY_METHODS)[number]['key']): RecoveryChannelState => {
    const r = siteConfig.recovery;
    const enabled =
      key === 'email'
        ? r.emailEnabled
        : key === 'service'
          ? r.serviceEnabled
          : key === 'master'
            ? r.masterEnabled
            : r.securityEnabled;
    if (!enabled) return 'disabled';
    /* 只有站内客服依赖具体账号；站长求助靠站内申请送达，不需要额外联系方式 */
    if (key === 'service' && !r.serviceAccount) return 'unconfigured';
    if (key === 'email' || key === 'security') return 'reserved';
    return 'available';
  };

  const STATE_LABEL: Record<RecoveryChannelState, string> = {
    available: '可用',
    disabled: '未开放',
    unconfigured: '未配置',
    reserved: '预留',
  };

  /** 提交找回申请：四种渠道走同一个入口，服务端返回状态与联系方式 */
  const submitRecover = async (method: (typeof RECOVERY_METHODS)[number]['key']) => {
    setError('');
    setRecoverResult(null);
    if (!recoverAccount.trim()) {
      setError('请先填写要找回的登录账号或用户编号');
      return;
    }
    setRecovering(method);
    try {
      const result = await api.auth.recover({ account: recoverAccount.trim(), method });
      setRecoverResult({
        message: result.message || '申请已受理，请按下面的方式联系我们。',
        channel: result.channels?.[method] || { available: true, state: 'available', label: '', hint: '' },
        requestId: result.requestId,
        tone: 'ok',
      });
    } catch (err) {
      /* 预留 / 未配置 / 账号不存在 / 未开放 都会带上 channels，如实展示服务端给出的原因 */
      const payload = err instanceof ApiError ? (err.payload as RecoveryResult | null) : null;
      if (payload?.channels) {
        setRecoverResult({
          message: payload.error || payload.message || '该方式暂时不可用，请换一种试试',
          channel: payload.channels[method] || { available: false, state: 'disabled', label: '', hint: '' },
          tone: 'warn',
        });
        return;
      }
      setError(err instanceof ApiError ? err.message : '找回申请提交失败，请稍后再试');
    } finally {
      setRecovering('');
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (locked) return;
    if (isRegister) {
      /* 唯一的硬性要求就是长度；是否包含用户名、是否常见一律不拦 */
      if (password.length < siteConfig.minPasswordLength) {
        setError(`密码至少需要 ${siteConfig.minPasswordLength} 位`);
        return;
      }
      if (password !== confirm) {
        setError('两次输入的密码不一致');
        return;
      }
      if (nickname.trim() && !/^[A-Za-z0-9_\-\u4e00-\u9fa5 ]{2,16}$/.test(nickname.trim())) {
        setError('昵称需为 2-16 位中英文、数字、下划线或空格');
        return;
      }
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
        setError('邮箱格式不正确');
        return;
      }
      if (verification.emailRequired && !email.trim()) {
        setError('本站要求注册时填写邮箱');
        return;
      }
      if (phone.trim() && !/^1[3-9]\d{9}$/.test(phone.trim())) {
        setError('手机号格式不正确');
        return;
      }
      if (verification.phoneRequired && !phone.trim()) {
        setError('本站要求注册时填写手机号');
        return;
      }
      if (verification.realNameEnabled) {
        if (realName.trim() && !/^(?:[\u4e00-\u9fa5]{2,20}|[A-Za-z][A-Za-z .'-]{1,39})$/.test(realName.trim())) {
          setError('姓名格式不正确，请填写真实姓名');
          return;
        }
        if (idNumber.trim() && !/^\d{17}[\dXx]$/.test(idNumber.trim())) {
          setError('证件号码格式不正确');
          return;
        }
        if (verification.realNameRequired && (!realName.trim() || !idNumber.trim())) {
          setError('本站要求注册时填写实名信息');
          return;
        }
      }
    }
    try {
      if (isRegister) {
        await register(
          {
            username: username.trim(),
            password,
            confirm,
            nickname: nickname.trim(),
            email: email.trim(),
            phone: phone.trim(),
            realName: realName.trim(),
            idNumber: idNumber.trim(),
          },
          honeypot
        );
        notify('账号已创建，匿名身份已生成，欢迎来到心事站', 'success');
      } else {
        await login(username.trim(), password, honeypot);
        /* 只在登录成功后写存储：避免把打错的密码留在本机 */
        saveRemembered({
          username: username.trim(),
          password,
          rememberAccount: rememberAccount || rememberPassword,
          rememberPassword,
        });
        notify('已登录，欢迎回来', 'success');
      }
      dismiss();
    } catch (err) {
      readFailure(err, '操作失败，请稍后再试');
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && dismiss()}>
      <motion.div
        className="modal-card"
        style={{ maxWidth: 400, maxHeight: '88vh', overflowY: 'auto' }}
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <div className="card-head">
          <div>
            <div className="card-title">
              {isRecover ? '找回密码' : isRegister ? '创建账号' : '登录心事站'}
            </div>
            <div className="card-sub">
              {isRecover
                ? '选一种方式联系我们，核实身份后协助重置'
                : isRegister
                  ? '昵称可以自己取，配色由系统分配，真实身份不会被展示'
                  : '用你的账号回到这里'}
            </div>
          </div>
          <button type="button" className="btn-icon" onClick={dismiss} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        {isRecover ? (
          <div className="card-pad stack" style={{ gap: 'var(--sp-3)' }}>
            <label className="field">
              <span className="field-label">
                登录账号
                <span className="faint" style={{ marginLeft: 6, fontSize: 12 }}>必填</span>
              </span>
              <input
                className="input"
                value={recoverAccount}
                onChange={(e) => setRecoverAccount(e.target.value)}
                placeholder="用户名或用户编号 UID"
                autoComplete="username"
                autoFocus
              />
            </label>

            <div className="stack" style={{ gap: 'var(--sp-2)' }}>
              {RECOVERY_METHODS.map((item) => {
                const Icon = item.icon;
                const state = channelState(item.key);
                const active = recovering === item.key;
                const usable = state === 'available';
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="recover-option"
                    onClick={() => submitRecover(item.key)}
                    disabled={Boolean(recovering) || !usable || !recoverAccount.trim()}
                  >
                    <Icon size={16} />
                    <span className="grow" style={{ textAlign: 'left', minWidth: 0 }}>
                      <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <span className="review-name">{item.label}</span>
                        <span className={usable ? 'tag tag-success' : 'tag'}>{STATE_LABEL[state]}</span>
                      </span>
                      <span className="faint" style={{ display: 'block', fontSize: 12 }}>
                        {state === 'unconfigured'
                          ? '管理员还没有填写联系方式，暂时走不通'
                          : item.desc}
                      </span>
                    </span>
                    {active && <span className="hint">提交中…</span>}
                  </button>
                );
              })}
            </div>

            {recoverResult && (
              <div className={recoverResult.tone === 'ok' ? 'form-note' : 'form-error'}>
                <div>{recoverResult.message}</div>
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  {recoverResult.requestId ? <div>受理编号：#{recoverResult.requestId}</div> : null}
                  {recoverResult.channel.account && <div>客服账号：{recoverResult.channel.account}</div>}
                  {recoverResult.channel.contact && <div>站长联系方式：{recoverResult.channel.contact}</div>}
                  {recoverResult.channel.hint && <div>{recoverResult.channel.hint}</div>}
                </div>
              </div>
            )}

            {error && <div className="form-error">{error}</div>}

            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              出于安全考虑，我们不会通过任何渠道索取你的密码。申请会留下记录，核实身份后由管理员协助重置。
            </p>

            <button type="button" className="btn btn-ghost" onClick={() => openAuth('login')}>
              <ArrowLeft size={14} /> 返回登录
            </button>
          </div>
        ) : registerBlocked ? (
          <div className="card-pad stack" style={{ gap: 'var(--sp-4)' }}>
            <div className="form-error">管理员暂未开放新用户注册，请稍后再来看看</div>
            {siteConfig.allowGuestLogin && (
              <button type="button" className="btn btn-lg" disabled={busy || locked} onClick={enterAsGuest}>
                <Ghost size={15} /> 先以访客身份逛逛
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => openAuth('login')}>
              返回登录
            </button>
          </div>
        ) : (
        <form className="card-pad stack" onSubmit={submit} style={{ gap: 'var(--sp-4)' }}>
          {/* 蜜罐字段：真人看不到也点不到，自动化脚本却会顺手填满，一旦有值服务端直接判定为机器人 */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
            <label>
              请勿填写此栏
              <input
                type="text"
                name="website"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
              />
            </label>
          </div>

          <label className="field">
            <span className="field-label">用户名</span>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="3-20 位中文、字母、数字或下划线"
              autoComplete="username"
              autoFocus
            />
          </label>

          <label className="field">
            <span className="field-label">
              密码
              {isRegister && (
                <span className="faint" style={{ marginLeft: 6, fontSize: 12 }}>
                  至少 {siteConfig.minPasswordLength} 位，建议混合大小写、数字与符号
                </span>
              )}
            </span>
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder={isRegister ? `至少 ${siteConfig.minPasswordLength} 位` : '请输入密码'}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
            {isRegister && <PasswordStrength assessment={passwordAssessment} />}
          </label>

          {!isRegister && (
            <div className="stack" style={{ gap: 'var(--sp-2)' }}>
              <label className="remember-row">
                <span className="grow">
                  <span className="remember-label">记住账号</span>
                  <span className="remember-hint">下次打开自动填好用户名</span>
                </span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={rememberAccount}
                  onChange={(e) => setRememberAccount(e.target.checked)}
                />
              </label>
              <label className="remember-row">
                <span className="grow">
                  <span className="remember-label">记住密码</span>
                  <span className="remember-hint">口令只保存在本机浏览器，公共设备请勿开启</span>
                </span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={rememberPassword}
                  onChange={(e) => {
                    setRememberPassword(e.target.checked);
                    /* 记住密码必然要记住账号，顺手带上 */
                    if (e.target.checked) setRememberAccount(true);
                  }}
                />
              </label>
            </div>
          )}

          {isRegister && (
            <label className="field">
              <span className="field-label">确认密码</span>
              {/* 每个密码框各管各的显隐，确认密码不跟着密码框一起变 */}
              <PasswordInput
                value={confirm}
                onChange={setConfirm}
                placeholder="再输入一次"
                autoComplete="new-password"
              />
            </label>
          )}

          {isRegister && (
            <label className="field">
              <span className="field-label">
                昵称<span className="faint" style={{ marginLeft: 6, fontSize: 12 }}>选填，留空由系统分配</span>
              </span>
              <input
                className="input"
                value={nickname}
                maxLength={16}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="2-16 位中英文、数字或下划线"
                autoComplete="nickname"
              />
            </label>
          )}

          {(verification.emailEnabled || verification.phoneEnabled) && (
            <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
              {verification.emailEnabled && (
                <label className="field grow">
                  <span className="field-label">
                    邮箱
                    {verification.emailRequired && <span className="tag tag-warning" style={{ marginLeft: 6 }}>必填</span>}
                  </span>
                  <input
                    className="input"
                    type="email"
                    value={email}
                    maxLength={190}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="用于找回账号"
                    autoComplete="email"
                  />
                </label>
              )}
              {verification.phoneEnabled && (
                <label className="field grow">
                  <span className="field-label">
                    手机号
                    {verification.phoneRequired && <span className="tag tag-warning" style={{ marginLeft: 6 }}>必填</span>}
                  </span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={phone}
                    maxLength={11}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="11 位手机号"
                    autoComplete="tel"
                  />
                </label>
              )}
            </div>
          )}

          {isRegister && verification.realNameEnabled && (
            <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
              <label className="field grow">
                <span className="field-label">
                  真实姓名
                  {verification.realNameRequired && <span className="tag tag-warning" style={{ marginLeft: 6 }}>必填</span>}
                </span>
                <input
                  className="input"
                  value={realName}
                  maxLength={40}
                  onChange={(e) => setRealName(e.target.value)}
                  placeholder="用于身份核验"
                />
              </label>
              <label className="field grow">
                <span className="field-label">
                  证件号码
                  {verification.realNameRequired && <span className="tag tag-warning" style={{ marginLeft: 6 }}>必填</span>}
                </span>
                <input
                  className="input"
                  value={idNumber}
                  maxLength={18}
                  onChange={(e) => setIdNumber(e.target.value)}
                  placeholder="18 位身份证号"
                />
              </label>
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          {locked && (
            <div className="form-error" role="status">
              触发安全保护，请 {formatCountdown(remaining)} 后再试。多次失败会持续延长锁定时间。
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-lg" disabled={busy || locked}>
            {busyLabel || (isRegister ? '创建账号' : '登录')}
          </button>

          {slowHint && busy && (
            <p className="muted" style={{ fontSize: 12, margin: 0, textAlign: 'center' }}>
              正在完成一次设备安全校验，比平时稍慢，这一次之后就会很快。
            </p>
          )}

          {!isRegister && (
            <div className="row" style={{ justifyContent: 'center', fontSize: 12 }}>
              <button type="button" className="link-btn" onClick={() => openAuth('recover')}>
                忘记密码？
              </button>
            </div>
          )}

          <p className="muted" style={{ fontSize: 12, margin: 0, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <ShieldCheck size={13} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              登录与注册请求会先建立一次性加密通道，密码在本地二次加密后传输；
              连续失败会触发工作量证明升级与临时锁定。
            </span>
          </p>

          {!isRegister && siteConfig.allowGuestLogin && (
            <>
              <div className="row" style={{ alignItems: 'center', gap: 'var(--sp-3)' }}>
                <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span className="muted" style={{ fontSize: 12 }}>或</span>
                <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <button type="button" className="btn btn-lg" disabled={busy || locked} onClick={enterAsGuest}>
                <Ghost size={15} /> 访客身份进入
              </button>
              <p className="muted" style={{ fontSize: 12, textAlign: 'center', margin: 0 }}>
                访客只能浏览全站内容，不能发言或修改资料；每次进入都会记录留痕
              </p>
            </>
          )}

          {(isRegister || siteConfig.allowRegister) && (
            <div className="row" style={{ justifyContent: 'center', fontSize: 12 }}>
              <span className="muted">{isRegister ? '已经有账号了？' : '还没有账号？'}</span>
              <button
                type="button"
                className="link-btn"
                onClick={() => openAuth(isRegister ? 'login' : 'register')}
              >
                {isRegister ? '去登录' : '去注册'}
              </button>
            </div>
          )}
        </form>
        )}
      </motion.div>
    </div>
  );
}
