import useAuthorization from './useAuthorization.js';

export default function RolePreviewControl() {
  const { previewConfig, previewRole, setPreviewRole } = useAuthorization();
  if (!previewConfig.enabled) return null;

  return (
    <section className="role-preview-control" aria-labelledby="role-preview-label">
      <label id="role-preview-label" htmlFor="role-preview-select">Role Preview</label>
      <select
        id="role-preview-select"
        value={previewRole ?? ''}
        onChange={(event) => setPreviewRole(event.target.value || null)}
      >
        <option value="">Off — unconnected access</option>
        {previewConfig.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <span>Development only · resets on refresh</span>
    </section>
  );
}
