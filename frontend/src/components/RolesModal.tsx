import { useEffect, useState, useMemo } from "react";
import { X, Settings, Zap, Terminal } from "lucide-react";
import { useJarvisStore } from "../store";
import { requestRoles, setRoleConfig, clearRolesOverride } from "../hooks/useSocket";
import { API_COLOR } from "./shared";

export function RolesModal({ onClose }: { onClose: () => void }) {
  const activeFolder = useJarvisStore((s) => s.activeFolder);
  const rolesState = useJarvisStore((s) => s.roles);
  const clis = useJarvisStore((s) => s.clis);
  const providers = useJarvisStore((s) => s.providers);
  const providerModels = useJarvisStore((s) => s.providerModels);

  // We are overriding if we have an activeFolder and want to edit its config.
  const [useOverride, setUseOverride] = useState(false);

  useEffect(() => {
    // When the modal opens, check if there's already an override file for this folder?
    // Actually, we can just request the roles for this folder when toggled.
    requestRoles(useOverride ? activeFolder : "");
  }, [useOverride, activeFolder]);

  function handleToggleOverride(checked: boolean) {
    setUseOverride(checked);
    if (!checked && activeFolder) {
      clearRolesOverride(activeFolder);
    }
  }

  if (!rolesState) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div className="glass-panel w-[560px] max-w-[94vw] p-5 flex flex-col" style={{ maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-[12px] tracking-[0.2em] uppercase text-white/90">Agent Roles</span>
          </div>
          <button onClick={onClose} className="grid place-items-center h-7 w-7 rounded-md hover:bg-white/[0.05]">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {activeFolder && (
          <div className="mb-4 flex items-center gap-2 font-mono text-[11px]">
            <input 
              type="checkbox" 
              checked={useOverride} 
              onChange={(e) => handleToggleOverride(e.target.checked)} 
              className="accent-[#a855f7]"
            />
            <span className="text-white/80">Override for this project ({activeFolder})</span>
          </div>
        )}

        <div className="flex flex-col gap-6">
          <RoleRow 
            title="Prompt Enhancer" 
            roleName="enhancer"
            config={rolesState.enhancer}
            clis={clis}
            providers={providers}
            providerModels={providerModels}
            targetFolder={useOverride ? activeFolder : ""}
          />
          <div className="border-t border-white/[0.06]"></div>
          <RoleRow
            title="Coder"
            roleName="coder"
            config={rolesState.coder}
            clis={clis}
            providers={providers}
            providerModels={providerModels}
            targetFolder={useOverride ? activeFolder : ""}
          />
          <div className="border-t border-white/[0.06]"></div>
          <RoleRow
            title="Intent Router"
            roleName="router"
            config={rolesState.router}
            clis={clis}
            providers={providers}
            providerModels={providerModels}
            targetFolder={useOverride ? activeFolder : ""}
          />
        </div>
      </div>
    </div>
  );
}

function RoleRow({ title, roleName, config, clis, providers, providerModels, targetFolder }: any) {
  const isApi = config.kind === 'api' || config.kind === 'provider';
  const currentId = isApi ? config.id : config.id;
  
  const agents = useMemo(() => [
    ...clis.map((c: any) => ({ id: c.id, label: c.label, available: c.available, kind: "cli" })),
    ...providers.map((p: any) => ({ id: p.id, label: p.label, available: true, kind: "api" })),
  ], [clis, providers]);

  const selectedAgent = agents.find(a => a.id === currentId && (a.kind === 'cli' ? !isApi : isApi));
  const cli = !isApi ? clis.find((c: any) => c.id === currentId) : null;
  const provider = isApi ? providers.find((p: any) => p.id === currentId) : null;

  const models = useMemo(() => {
    if (isApi && provider) {
      return (providerModels[provider.id] ?? []).map((m: any) => ({ id: m.id, label: m.label }));
    }
    return cli?.models ?? [];
  }, [isApi, provider, providerModels, cli]);

  function handleChange(field: string, value: string) {
    const next = { ...config };
    if (field === 'agent') {
      const parts = value.split('::');
      next.kind = parts[0] === 'api' ? 'provider' : 'cli';
      next.id = parts[1];
      next.model = ''; // will be auto-selected by backend or user later
    } else {
      next[field] = value;
    }
    setRoleConfig(roleName, next, targetFolder);
  }

  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground mb-3">{title}</div>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <select 
          value={`${isApi ? 'api' : 'cli'}::${currentId}`}
          onChange={(e) => handleChange('agent', e.target.value)}
          className="bg-white/[0.03] border border-white/[0.08] rounded-md px-2 py-1.5 font-mono text-[11px] text-white/90 outline-none"
        >
          {agents.map((a: any) => (
            <option key={`${a.kind}::${a.id}`} value={`${a.kind}::${a.id}`} disabled={!a.available} className="bg-[#0b0b0f]">
              {a.kind === 'api' ? '[API] ' : '[CLI] '}{a.label} {!a.available ? '(unavailable)' : ''}
            </option>
          ))}
        </select>
        
        <select 
          value={config.model || ""} 
          onChange={(e) => handleChange('model', e.target.value)}
          className="bg-white/[0.03] border border-white/[0.08] rounded-md px-2 py-1.5 font-mono text-[11px] text-white/90 outline-none truncate"
        >
          {models.length === 0 && <option value="" className="bg-[#0b0b0f]">—</option>}
          {models.map((m: any) => <option key={m.id} value={m.id} className="bg-[#0b0b0f]">{m.label}</option>)}
        </select>

        {!isApi && (
          <select 
            value={config.effort || "medium"} 
            onChange={(e) => handleChange('effort', e.target.value)}
            className="bg-white/[0.03] border border-white/[0.08] rounded-md px-2 py-1.5 font-mono text-[11px] text-white/90 outline-none w-[90px]"
          >
            {(cli?.efforts ?? ["low", "medium", "high"]).map((e: string) => <option key={e} value={e} className="bg-[#0b0b0f]">{e}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}
