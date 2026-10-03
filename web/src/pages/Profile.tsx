import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck,
  Cake,
  Check,
  Ghost,
  Hash,
  Inbox,
  KeyRound,
  LifeBuoy,
  Mail,
  MapPin,
  PenLine,
  Plus,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  X,
  ZoomIn,
} from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { Gender, MyRecoveryItem, ProfilePatch } from '@/api/types';
import { Avatar } from '@/components/common/Avatar';
import { AvatarCropper } from '@/components/common/AvatarCropper';
import { AvatarViewer } from '@/components/common/AvatarViewer';
import { DatePicker } from '@/components/common/DatePicker';
import { Empty } from '@/components/common/Empty';
import { GuestNotice } from '@/components/common/GuestNotice';
import { PasswordInput } from '@/components/common/PasswordInput';
import { PasswordStrength } from '@/components/common/PasswordStrength';
import { assessPassword } from '@/lib/password';
import { formatDate, formatDateTime } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useSite } from '@/store/site';
import { useUi } from '@/store/ui';

const ROLE_LABELS: Record<string, string> = {
  superadmin: '超级管理员',
  admin: '管理员',
  reviewer: '审核员',
  user: '住客',
  guest: '访客',
};

const GENDERS: { value: Gender; label: string }[] = [
  { value: 'secret', label: '保密' },
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'other', label: '其他' },
];

const GENDER_LABELS: Record<Gender, string> = {
  secret: '保密',
  male: '男',
  female: '女',
  other: '其他',
};

export function Profile() {
  const user = useAuth((s) => s.user);
  const patchUser = useAuth((s) => s.patchUser);
  const updateAccount = useAuth((s) => s.updateAccount);
  const refreshUser = useAuth((s) => s.refreshUser);
  const notify = useUi((s) => s.notify);
  const openAuth = useUi((s) => s.openAuth);
  const siteConfig = useSite((s) => s.config);
  const verification = siteConfig.verification;

  const fileRef = useRef<HTMLInputElement>(null);
  const [bio, setBio] = useState('');
  const [intro, setIntro] = useState('');
  const [nickname, setNickname] = useState('');
  const [gender, setGender] = useState<Gender>('secret');
  const [age, setAge] = useState('');
  const [birthday, setBirthday] = useState('');
  const [occupation, setOccupation] = useState('');
  const [location, setLocation] = useState('');
  const [hobbies, setHobbies] = useState<string[]>([]);
  const [hobbyDraft, setHobbyDraft] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [realName, setRealName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  /* 账号与密码修改 */
  const [nextUsername, setNextUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);

  /* 我提交过的找回申请：处理结果要能在这里直接看到，不用去翻站内信 */
  const [recoveries, setRecoveries] = useState<MyRecoveryItem[]>([]);
  /* 放大查看待审头像 */
  const [zoomAvatar, setZoomAvatar] = useState(false);
  /* 待裁剪的原始文件：确认区域后才真正上传 */
  const [cropping, setCropping] = useState<File | null>(null);

  /*
   * 头像审核、封禁这类变更由**别人**发起，不经过本地写接口。
   * 进资料页时主动拉一次身份，避免还停在上一次的快照上 ——
   * 自己把自己的头像驳回了，这里也该立刻显示「未通过」。
   */
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    if (!user) return;
    api.auth
      .recoveryMine()
      .then(({ requests }) => setRecoveries(requests))
      .catch(() => setRecoveries([]));
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    setBio(user.bio);
    setIntro(user.intro);
    setNickname(user.nickname || '');
    setGender(user.gender);
    setAge(user.age === null ? '' : String(user.age));
    setBirthday(user.birthday || '');
    setOccupation(user.occupation);
    setLocation(user.location);
    setHobbies(user.hobbies);
    setEmail(user.email || '');
    setPhone(user.phone || '');
    setRealName(user.realName || '');
    setIdNumber(user.idNumber || '');
    setNextUsername('');
  }, [user?.id]);

  if (!user) {
    return (
      <Empty
        icon={<UserRound size={26} />}
        title="登录后才能查看个人信息"
        desc="登录之后，这里会显示你在站内的名字、签名与账号状态"
        action={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => openAuth('login')}
            style={{ marginTop: 'var(--sp-2)' }}
          >
            去登录
          </button>
        }
      />
    );
  }

  const save = async (patch: ProfilePatch, message?: string) => {
    setSaving(true);
    try {
      const { user: updated } = await api.auth.updateProfile(patch);
      patchUser(updated);
      if (message) notify(message, 'success');
      return updated;
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '保存失败', 'danger');
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const saveBio = () => save({ bio }, '签名已更新');

  const saveProfile = async () => {
    if (guardGuest()) return;
    if (age !== '' && (Number(age) < 0 || Number(age) > 120 || !Number.isInteger(Number(age)))) {
      notify('年龄需为 0-120 的整数', 'danger');
      return;
    }
    const trimmedNickname = nickname.trim();
    if (trimmedNickname && !/^[A-Za-z0-9_\-\u4e00-\u9fa5 ]{2,16}$/.test(trimmedNickname)) {
      notify('昵称需为 2-16 位中英文、数字、下划线或空格', 'danger');
      return;
    }

    const patch: ProfilePatch = {
      intro,
      nickname: trimmedNickname,
      gender,
      age: age === '' ? null : Number(age),
      birthday: birthday || null,
      occupation,
      location,
      hobbies,
    };

    /* 预留能力：开关未开启的字段不提交，避免误触尚未开放的接口 */
    if (verification.emailEnabled) {
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
        notify('邮箱格式不正确', 'danger');
        return;
      }
      if (verification.emailRequired && !email.trim()) {
        notify('本站要求填写邮箱', 'danger');
        return;
      }
      patch.email = email.trim();
    }
    if (verification.phoneEnabled) {
      if (phone.trim() && !/^1[3-9]\d{9}$/.test(phone.trim())) {
        notify('手机号格式不正确', 'danger');
        return;
      }
      if (verification.phoneRequired && !phone.trim()) {
        notify('本站要求填写手机号', 'danger');
        return;
      }
      patch.phone = phone.trim();
    }
    if (verification.realNameEnabled) {
      if (realName.trim() && !/^(?:[\u4e00-\u9fa5]{2,20}|[A-Za-z][A-Za-z .'-]{1,39})$/.test(realName.trim())) {
        notify('姓名格式不正确，请填写真实姓名', 'danger');
        return;
      }
      if (idNumber.trim() && !/^\d{17}[\dXx]$/.test(idNumber.trim())) {
        notify('证件号码格式不正确', 'danger');
        return;
      }
      if (verification.realNameRequired && (!realName.trim() || !idNumber.trim())) {
        notify('本站要求完成实名信息填写', 'danger');
        return;
      }
      patch.realName = realName.trim();
      patch.idNumber = idNumber.trim();
    }

    try {
      await save(patch, '资料已更新');
    } catch {
      /* 错误已提示 */
    }
  };

  /** 登录账号 / 密码修改：必须先用当前密码确认身份 */
  const saveAccount = async () => {
    if (guardGuest()) return;
    const targetUsername = nextUsername.trim();
    const wantsUsername = Boolean(targetUsername) && targetUsername !== user.username;
    const wantsPassword = Boolean(newPassword);
    if (!wantsUsername && !wantsPassword) {
      notify('请填写要修改的登录账号或新密码', 'info');
      return;
    }
    if (wantsPassword && newPassword.length < siteConfig.minPasswordLength) {
      notify(`密码至少需要 ${siteConfig.minPasswordLength} 位`, 'danger');
      return;
    }
    if (wantsPassword && newPassword !== confirmPassword) {
      notify('两次输入的新密码不一致', 'danger');
      return;
    }
    if (!currentPassword) {
      notify('请输入当前密码以确认身份', 'danger');
      return;
    }
    setAccountBusy(true);
    try {
      await updateAccount({
        username: wantsUsername ? targetUsername : undefined,
        currentPassword,
        newPassword: wantsPassword ? newPassword : undefined,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNextUsername('');
      notify(
        wantsPassword ? '账号信息与密码已更新，其他设备上的登录态已失效' : '登录账号已更新',
        'success'
      );
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '账号修改失败', 'danger');
    } finally {
      setAccountBusy(false);
    }
  };

  /**
   * 预留的验证触发入口：开关关闭时服务端会直接拒绝，
   * 开启后当前提示「通道尚未接入」，接入真实验证服务后此处无需改动。
   */
  const requestVerify = async (kind: 'email' | 'phone' | 'realname', label: string) => {
    try {
      await api.auth.requestVerification(kind);
      notify(`${label}验证请求已提交`, 'success');
    } catch (error) {
      notify(error instanceof ApiError ? error.message : `${label}验证请求失败`, 'warning');
    }
  };

  /** 访客只读：所有写入操作统一在这里被拦下并引导注册 */
  const guardGuest = () => {
    if (!user?.isGuest) return false;
    notify('访客账号只能浏览，注册后才能修改资料', 'info');
    openAuth('register');
    return true;
  };

  const pickAvatar = (file: File) => {
    if (guardGuest()) return;
    /*
     * 先让用户选好要展示的区域，再上传。
     * 直接拿原图去传，头像被圆裁掉哪一块全靠运气 —— 尤其是人和脸不在正中的照片。
     */
    setCropping(file);
  };

  /** 裁剪器给回来的方图，直接上传 */
  const uploadAvatar = async (blob: Blob) => {
    setUploading(true);
    try {
      const name = blob.type === 'image/png' ? 'avatar.png' : 'avatar.jpg';
      const { urls } = await api.uploads.images([new File([blob], name, { type: blob.type })]);
      if (!urls[0]) throw new Error('上传未返回地址');
      const updated = await save({ avatarUrl: urls[0] });
      notify(
        updated.avatarStatus === 'pending' ? '新头像已提交，管理员审核通过后全站生效' : '头像已更新',
        'success'
      );
      setCropping(null);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '头像上传失败', 'danger');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const cancelCrop = () => {
    setCropping(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeAvatar = () => {
    if (guardGuest()) return;
    save({ avatarUrl: '' }, '已恢复默认头像');
  };

  const addHobby = () => {
    const value = hobbyDraft.trim().slice(0, 12);
    if (!value) return;
    if (hobbies.includes(value)) {
      notify('这个爱好已经在列表里了', 'info');
      return;
    }
    if (hobbies.length >= 8) {
      notify('最多添加 8 个爱好', 'info');
      return;
    }
    setHobbies([...hobbies, value]);
    setHobbyDraft('');
  };

  const roleLabel = ROLE_LABELS[user.role] || '住客';
  const statusText = user.ban ? '封禁中' : user.status === 'active' ? '正常' : user.status;
  /* 访客只读：这一页所有写入操作都要禁用 */
  const isGuest = Boolean(user.isGuest);

  /* 新密码强度同样只提示不拦截 */
  const newPasswordAssessment = assessPassword(newPassword, {
    minLength: siteConfig.minPasswordLength,
    username: nextUsername.trim() || user.username,
  });

  return (
    <div className="profile-layout">
      <div className="page-head">
        <h1 className="page-title">个人信息</h1>
        <p className="page-desc">头像、签名与资料都会全站生效，心事、留言和弹幕里都用同一张面孔</p>
      </div>

      {isGuest && (
        <GuestNotice
          title="访客账号不能修改个人信息"
          desc="访客身份仅用于浏览全站内容。注册一个正式账号后，这里就能设置昵称、头像与资料了。"
        />
      )}

      <section className="card card-pad profile-card">
        <div className="row" style={{ gap: 'var(--sp-4)', alignItems: 'flex-start' }}>
          <div className="avatar-editor">
            <Avatar name={user.anonName} color={user.anonColor} src={user.avatarUrl} size="lg" />
            <div className="avatar-editor-actions">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || saving || isGuest}
              >
                <Upload size={13} />
                {uploading ? '上传中…' : user.avatarUrl ? '更换头像' : '上传头像'}
              </button>
              {user.avatarUrl && (
                <button type="button" className="btn-icon" onClick={removeAvatar} disabled={saving} aria-label="移除头像">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) pickAvatar(file);
              }}
            />
            {user.avatarStatus === 'pending' && user.avatarPending && (
              <div className="row" style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
                <Avatar
                  name={user.anonName}
                  color={user.anonColor}
                  src={user.avatarPending}
                  size="sm"
                  onZoom={() => setZoomAvatar(true)}
                />
                <span className="tag tag-warning">新头像审核中</span>
                <button type="button" className="link-btn" onClick={() => setZoomAvatar(true)}>
                  <ZoomIn size={12} />
                  放大查看
                </button>
              </div>
            )}
            {user.avatarStatus === 'rejected' && (
              <p className="hint" style={{ marginTop: 'var(--sp-3)' }}>
                上一次提交的头像没有通过审核，可以换一张再试。
              </p>
            )}
          </div>

          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              <span className="profile-name">{user.anonName}</span>
              <span className="tag tag-primary">{roleLabel}</span>
              <span className="tag mono" title="你的用户编号">
                UID {user.uid ?? '—'}
              </span>
              <span className="tag">注册于 {formatDate(user.createdAt)}</span>
              {user.violationCount > 0 && <span className="tag tag-warning">违规 {user.violationCount} 次</span>}
            </div>

            <div className="row" style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
              <input
                className="input"
                value={bio}
                maxLength={80}
                onChange={(e) => setBio(e.target.value)}
                placeholder="写一句留给自己的签名（最多 80 字）"
                aria-label="个人签名"
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={saveBio}
                disabled={saving || bio === user.bio}
              >
                <Check size={13} />
                保存
              </button>
            </div>
          </div>
        </div>

        {user.ban && (
          <div className="ban-banner">
            <ShieldAlert size={15} />
            <div className="grow">
              <div style={{ fontWeight: 500 }}>账号处于封禁状态</div>
              <div className="muted" style={{ fontSize: 12 }}>
                原因：{user.ban.reason}
                {user.ban.until ? `，解封时间 ${formatDateTime(user.ban.until)}` : '，永久封禁'}
              </div>
            </div>
          </div>
        )}

        {user.role === 'guest' && (
          <div className="ban-banner">
            <Ghost size={15} />
            <div className="grow">
              <div style={{ fontWeight: 500 }}>当前为访客身份</div>
              <div className="muted" style={{ fontSize: 12 }}>
                本次访客登录已被记录；注册正式账号后即可发布心事、留言与弹幕
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="card card-pad">
        <div className="section-title">
          <Sparkles size={14} />
          个人资料
        </div>

        <div className="profile-form">
          <div className="field">
            <label className="field-label" htmlFor="pf-intro">
              自我介绍
            </label>
            <textarea
              id="pf-intro"
              className="textarea"
              rows={3}
              maxLength={200}
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              placeholder="用几句话介绍自己，最多 200 字"
            />
            <span className="field-hint mono">{intro.length}/200</span>
          </div>

          <div className="profile-form-grid">
            <div className="field">
              <label className="field-label" htmlFor="pf-nickname">
                昵称
              </label>
              <input
                id="pf-nickname"
                className="input"
                maxLength={16}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="留空则使用系统分配的匿名身份"
              />
              <span className="field-hint">2-16 位中英文、数字、下划线或空格</span>
            </div>

            <div className="field">
              <label className="field-label">性别</label>
              <div className="segmented">
                {GENDERS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    data-active={gender === item.value}
                    onClick={() => setGender(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="pf-age">
                年龄
              </label>
              <input
                id="pf-age"
                className="input"
                type="number"
                min={0}
                max={120}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="留空表示不公开"
              />
            </div>

            <div className="field">
              <span className="field-label">
                <Cake size={12} />
                生日
              </span>
              <DatePicker
                value={birthday}
                onChange={setBirthday}
                placeholder="选择生日"
                ariaLabel="选择生日"
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="pf-occupation">
                职业 / 身份
              </label>
              <input
                id="pf-occupation"
                className="input"
                maxLength={30}
                value={occupation}
                onChange={(e) => setOccupation(e.target.value)}
                placeholder="例如：夜班编辑"
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="pf-location">
                <MapPin size={12} />
                所在地
              </label>
              <input
                id="pf-location"
                className="input"
                maxLength={30}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="例如：杭州"
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label">爱好（最多 8 个）</label>
            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              <input
                className="input"
                maxLength={12}
                value={hobbyDraft}
                onChange={(e) => setHobbyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addHobby();
                  }
                }}
                placeholder="输入后按回车添加"
              />
              <button type="button" className="btn btn-sm" onClick={addHobby} disabled={!hobbyDraft.trim()}>
                <Plus size={13} />
                添加
              </button>
            </div>
            {hobbies.length > 0 && (
              <div className="chips">
                {hobbies.map((item) => (
                  <span key={item} className="chip">
                    {item}
                    <button
                      type="button"
                      className="chip-remove"
                      onClick={() => setHobbies(hobbies.filter((h) => h !== item))}
                      aria-label={`移除 ${item}`}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'var(--sp-4)' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={saveProfile} disabled={saving || isGuest}>
            <Check size={13} />
            {saving ? '保存中…' : '保存资料'}
          </button>
        </div>
      </section>

      <section className="card card-pad">
        <div className="section-title">
          <ShieldCheck size={14} />
          身份验证
          <span className="faint" style={{ fontSize: 12, fontWeight: 400 }}>
            预留能力 · 由超级管理员控制
          </span>
        </div>

        {!verification.emailEnabled && !verification.phoneEnabled && !verification.realNameEnabled ? (
          <div className="read-only-note">
            <ShieldAlert size={15} />
            <div className="grow">
              邮箱验证、手机号验证与实名认证均已预留接口与数据字段，当前由超级管理员统一关闭，尚未对用户开放。
              开启后即可在此填写与修改。
            </div>
          </div>
        ) : (
          <div className="profile-form">
            <div className="profile-form-grid">
              {verification.emailEnabled && (
                <div className="field">
                  <span className="field-label">
                    <Mail size={12} /> 邮箱
                    {user.verified.email ? (
                      <span className="tag tag-success" style={{ marginLeft: 6 }}>
                        已验证
                      </span>
                    ) : (
                      <span className="tag" style={{ marginLeft: 6 }}>
                        未验证
                      </span>
                    )}
                  </span>
                  <div className="row" style={{ gap: 'var(--sp-2)' }}>
                    <input
                      className="input"
                      type="email"
                      maxLength={190}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!email.trim()}
                      onClick={() => requestVerify('email', '邮箱')}
                    >
                      发送验证
                    </button>
                  </div>
                  {verification.emailRequired && <span className="field-hint">本站要求填写邮箱</span>}
                </div>
              )}

              {verification.phoneEnabled && (
                <div className="field">
                  <span className="field-label">
                    <Smartphone size={12} /> 手机号
                    {user.verified.phone ? (
                      <span className="tag tag-success" style={{ marginLeft: 6 }}>
                        已验证
                      </span>
                    ) : (
                      <span className="tag" style={{ marginLeft: 6 }}>
                        未验证
                      </span>
                    )}
                  </span>
                  <div className="row" style={{ gap: 'var(--sp-2)' }}>
                    <input
                      className="input"
                      inputMode="numeric"
                      maxLength={11}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="11 位手机号"
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!phone.trim()}
                      onClick={() => requestVerify('phone', '手机号')}
                    >
                      发送验证
                    </button>
                  </div>
                  {verification.phoneRequired && <span className="field-hint">本站要求填写手机号</span>}
                </div>
              )}
            </div>

            {verification.realNameEnabled && (
              <div className="profile-form-grid">
                <div className="field">
                  <span className="field-label">
                    <BadgeCheck size={12} /> 姓名
                    {user.verified.realName ? (
                      <span className="tag tag-success" style={{ marginLeft: 6 }}>
                        已认证
                      </span>
                    ) : (
                      <span className="tag" style={{ marginLeft: 6 }}>
                        待认证
                      </span>
                    )}
                  </span>
                  <input
                    className="input"
                    maxLength={40}
                    value={realName}
                    onChange={(e) => setRealName(e.target.value)}
                    placeholder="请输入真实姓名"
                  />
                </div>
                <div className="field">
                  <span className="field-label">证件号码</span>
                  <input
                    className="input"
                    maxLength={18}
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                    placeholder="18 位身份证号"
                  />
                </div>
              </div>
            )}

            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              实名资料会加密后存储，仅用于身份核验；修改任一验证信息后，原认证状态会自动失效并需要重新核验。
            </p>

            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={saveProfile} disabled={saving || isGuest}>
                <Check size={13} />
                {saving ? '保存中…' : '保存验证信息'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card card-pad">
        <div className="section-title">
          <KeyRound size={14} />
          账号与安全
        </div>

        <div className="profile-form">
          <div className="profile-form-grid">
            <div className="field">
              <label className="field-label" htmlFor="pf-username">
                登录账号
              </label>
              <input
                id="pf-username"
                className="input"
                value={nextUsername}
                maxLength={20}
                onChange={(e) => setNextUsername(e.target.value)}
                placeholder={user.username}
              />
              <span className="field-hint">留空表示不修改，2-20 位中英文、数字或下划线</span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="pf-current-password">
                原密码
              </label>
              <PasswordInput
                id="pf-current-password"
                value={currentPassword}
                onChange={setCurrentPassword}
                /* **** 只出现在这里：提示「账号已有密码」，不是已经在框里了 */
                placeholder="****"
                autoComplete="current-password"
              />
              <span className="field-hint">请输入当前密码以确认身份；输入后可点右侧图标临时查看</span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="pf-new-password">
                新密码
              </label>
              <PasswordInput
                id="pf-new-password"
                value={newPassword}
                onChange={setNewPassword}
                placeholder="输入新密码"
                autoComplete="new-password"
              />
              <span className="field-hint">
                留空表示不修改；至少 {siteConfig.minPasswordLength} 位，建议混合大小写、数字与符号
              </span>
              <PasswordStrength assessment={newPasswordAssessment} />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="pf-confirm-password">
                确认新密码
              </label>
              {/* 与「新密码」各自独立显隐，方便对照检查是否输错 */}
              <PasswordInput
                id="pf-confirm-password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder="再输入一次新密码"
                autoComplete="new-password"
              />
            </div>
          </div>

          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            修改密码后，除当前设备外的其它登录状态会立即失效。任何改动都必须先通过当前密码确认身份。
          </p>

          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={saveAccount}
              disabled={accountBusy || isGuest || (!nextUsername.trim() && !newPassword)}
            >
              <Check size={13} />
              {accountBusy ? '提交中…' : '保存账号设置'}
            </button>
          </div>
        </div>
      </section>

      <section className="card card-pad">
        <div className="section-title">
          <LifeBuoy size={14} />
          找回密码记录
          <span className="card-sub">提交过的申请与处理结果都在这里，不必翻站内信</span>
        </div>

        {recoveries.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            没有提交过找回申请。忘记密码时可以在登录页点「忘记密码？」，用站内客服或站长求助发起申请。
          </p>
        ) : (
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            {recoveries.map((item) => (
              <div key={item.id} className="recovery-record" data-status={item.status}>
                <div className="row-between">
                  <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                    <span className="tag">{item.label}</span>
                    <span className="faint" style={{ fontSize: 11 }}>
                      受理编号 #{item.id}
                    </span>
                  </div>
                  <span
                    className={`tag ${
                      item.status === 'handled'
                        ? 'tag-success'
                        : item.status === 'rejected'
                          ? 'tag-danger'
                          : 'tag-warning'
                    }`}
                  >
                    {item.status === 'handled' ? '已通过' : item.status === 'rejected' ? '未通过' : '待处理'}
                  </span>
                </div>

                <div className="recovery-record-meta">
                  <span>提交于 {formatDateTime(item.createdAt)}</span>
                  {/* 申请时的来源 IP 完整回显，便于本人核对是否自己发起 */}
                  <span className="mono">来源 IP {item.ip || '未记录'}</span>
                </div>

                {item.handledAt && (
                  <div className="recovery-record-note">
                    <strong>{item.handledBy || '管理员'}</strong> 于 {formatDateTime(item.handledAt)} 处理
                    {item.handledNote ? `：${item.handledNote}` : ''}
                  </div>
                )}
                {item.status === 'open' && (
                  <div className="recovery-record-note">申请已受理，等待管理员核实身份，处理结果会同步到站内信。</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card card-pad">
        <div className="section-title">
          <UserRound size={14} />
          账号信息
        </div>
        <dl className="status-grid">
          <div>
            <dt>
              <Hash size={11} /> 用户编号
            </dt>
            <dd className="mono">{user.uid ?? '—'}</dd>
          </div>
          <div>
            <dt>站内昵称</dt>
            <dd>{user.anonName}</dd>
          </div>
          <div>
            <dt>登录账号</dt>
            <dd>{user.username}</dd>
          </div>
          <div>
            <dt>身份</dt>
            <dd>{roleLabel}</dd>
          </div>
          <div>
            <dt>账号状态</dt>
            <dd>{statusText}</dd>
          </div>
          <div>
            <dt>性别</dt>
            <dd>{GENDER_LABELS[user.gender]}</dd>
          </div>
          <div>
            <dt>生日</dt>
            <dd>{user.birthday || '未设置'}</dd>
          </div>
          <div>
            <dt>注册时间</dt>
            <dd>{formatDateTime(user.createdAt)}</dd>
          </div>
          <div>
            <dt>违规记录</dt>
            <dd>{user.violationCount} 次</dd>
          </div>
        </dl>
        <p className="muted" style={{ fontSize: 12, marginTop: 'var(--sp-4)' }}>
          昵称可以随时在「个人资料」里修改，配色由系统分配；所有心事、留言与弹幕都以这个昵称出现。
        </p>
      </section>

      <section className="card card-pad">
        <div className="section-title">
          <Settings size={14} />
          快捷入口
        </div>
        <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <Link className="btn btn-sm" to="/mine">
            <PenLine size={13} />
            我的心事
          </Link>
          <Link className="btn btn-sm" to="/notifications">
            <Inbox size={13} />
            站内信{user.unreadNotifications > 0 ? `（${user.unreadNotifications}）` : ''}
          </Link>
          <Link className="btn btn-sm" to="/settings">
            <Settings size={13} />
            设置
          </Link>
        </div>
      </section>

      {cropping && (
        <AvatarCropper file={cropping} busy={uploading} onCancel={cancelCrop} onConfirm={uploadAvatar} />
      )}

      {zoomAvatar && user.avatarPending && (
        <AvatarViewer
          name={user.anonName}
          shots={[
            { label: '待审新头像', src: user.avatarPending, hint: '审核通过后全站生效' },
            ...(user.avatarUrl ? [{ label: '当前头像', src: user.avatarUrl, hint: '正在使用' }] : []),
          ]}
          onClose={() => setZoomAvatar(false)}
        />
      )}
    </div>
  );
}