import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { loginSchema, registerSchema } from '@syncboard/shared/schemas';
import { login, register } from './authSlice.js';
import { zodFieldErrors, apiFieldErrors } from './formErrors.js';

function Field({ label, name, type = 'text', value, error, onChange, autoComplete }) {
  const id = `f-${name}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id} name={name} type={type} value={value} autoComplete={autoComplete}
        aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(name, e.target.value)}
      />
      {error && <p id={`${id}-err`} className="field__error">{error}</p>}
    </div>
  );
}

function useAuthForm(initial, schema, action) {
  const dispatch = useDispatch();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const onChange = (name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors(({ [name]: _gone, _form: _f, ...rest }) => rest);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    const clientErrors = zodFieldErrors(schema, values);
    if (clientErrors) return setErrors(clientErrors);
    setSubmitting(true);
    const result = await dispatch(action(values));
    setSubmitting(false);
    // On success, PublicOnly redirects to ?next or /boards.
    if (result.error) setErrors(apiFieldErrors(result.payload));
  };

  return { values, errors, submitting, onChange, onSubmit };
}

function AuthCard({ title, children, footer }) {
  return (
    <main className="auth">
      <div className="auth__card">
        <div className="brand"><span className="brand__mark" aria-hidden="true" />SyncBoard</div>
        <h1>{title}</h1>
        {children}
        <p className="auth__footer">{footer}</p>
      </div>
    </main>
  );
}

const withNext = (path, params) => (params.get('next') ? `${path}?next=${encodeURIComponent(params.get('next'))}` : path);

export function LoginPage() {
  const [params] = useSearchParams();
  const f = useAuthForm({ email: '', password: '' }, loginSchema, login);
  return (
    <AuthCard title="Log in" footer={<>No account? <Link to={withNext('/register', params)}>Create one</Link></>}>
      <form onSubmit={f.onSubmit} noValidate>
        <Field label="Email" name="email" type="email" autoComplete="email" value={f.values.email} error={f.errors.email} onChange={f.onChange} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" value={f.values.password} error={f.errors.password} onChange={f.onChange} />
        {f.errors._form && <p className="form__error" role="alert">{f.errors._form}</p>}
        <button className="btn btn--primary btn--block" disabled={f.submitting}>{f.submitting ? 'Logging in…' : 'Log in'}</button>
      </form>
    </AuthCard>
  );
}

export function RegisterPage() {
  const [params] = useSearchParams();
  const f = useAuthForm({ name: '', email: '', password: '' }, registerSchema, register);
  return (
    <AuthCard title="Create your account" footer={<>Already have one? <Link to={withNext('/login', params)}>Log in</Link></>}>
      <form onSubmit={f.onSubmit} noValidate>
        <Field label="Name" name="name" autoComplete="name" value={f.values.name} error={f.errors.name} onChange={f.onChange} />
        <Field label="Email" name="email" type="email" autoComplete="email" value={f.values.email} error={f.errors.email} onChange={f.onChange} />
        <Field label="Password" name="password" type="password" autoComplete="new-password" value={f.values.password} error={f.errors.password} onChange={f.onChange} />
        {f.errors._form && <p className="form__error" role="alert">{f.errors._form}</p>}
        <button className="btn btn--primary btn--block" disabled={f.submitting}>{f.submitting ? 'Creating…' : 'Create account'}</button>
      </form>
    </AuthCard>
  );
}
