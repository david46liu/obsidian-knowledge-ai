export type FeatureName = string;
export type QuotaResource = string;

export interface LicenseGate {
  canUseFeature(name: FeatureName): boolean;
  getTier(): 'free' | 'pro' | 'team';
  getQuota(resource: QuotaResource): { used: number; limit: number };
}

export class NoOpLicenseGate implements LicenseGate {
  canUseFeature(_name: FeatureName): boolean { return true; }
  getTier(): 'pro' { return 'pro'; }
  getQuota(_resource: QuotaResource): { used: number; limit: number } {
    return { used: 0, limit: Infinity };
  }
}
