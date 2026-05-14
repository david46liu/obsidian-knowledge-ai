import React from 'react';
import { PluginServicesContext, type PluginServices } from 'src/ui/hooks/useStore';
import { SettingsView } from 'src/ui/views/SettingsView';

interface AppProps {
  services: PluginServices;
}

export function App({ services }: AppProps) {
  return (
    <PluginServicesContext.Provider value={services}>
      <SettingsView />
    </PluginServicesContext.Provider>
  );
}
