'use client';

import { useState } from 'react';
import { InfoSidebar }       from '@/components/InfoSidebar';
import { InitiateSwapSection } from '@/components/InitiateSwapSection';
import { SettleSection }     from '@/components/SettleSection';
import { SwaptionSection }   from '@/components/SwaptionSection';
import { AccountSection }    from '@/components/AccountSection';

type Tab = 'swap' | 'settle' | 'swaption';

export default function Home() {
  const [tab, setTab] = useState<Tab>('swap');

  return (
    <div style={{ maxWidth: 1360, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 320px', gap: 20, alignItems: 'start' }}>

        {/* Left — protocol info */}
        <InfoSidebar />

        {/* Centre — main actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* Tab bar */}
          <div className="tab-bar">
            <button className={`tab ${tab === 'swap'     ? 'active' : ''}`} onClick={() => setTab('swap')}>
              Initiate Swap
            </button>
            <button className={`tab ${tab === 'settle'   ? 'active' : ''}`} onClick={() => setTab('settle')}>
              Settle
            </button>
            <button className={`tab ${tab === 'swaption' ? 'active' : ''}`} onClick={() => setTab('swaption')}>
              Swaption
            </button>
          </div>

          {tab === 'swap'     && <InitiateSwapSection />}
          {tab === 'settle'   && <SettleSection />}
          {tab === 'swaption' && <SwaptionSection />}
        </div>

        {/* Right — account + collateral */}
        <AccountSection />
      </div>
    </div>
  );
}
