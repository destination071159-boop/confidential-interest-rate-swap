'use client';

import { useState } from 'react';
import { CollateralSidebar }  from '@/components/CollateralSidebar';
import { InitiateSwapSection } from '@/components/InitiateSwapSection';
import { SettleSection }     from '@/components/SettleSection';
import { SwaptionSection }   from '@/components/SwaptionSection';
import { AccountSection }    from '@/components/AccountSection';
import { SwapTable }         from '@/components/SwapTable';

type Tab = 'swap' | 'settle' | 'swaption';

export default function Home() {
  const [tab, setTab] = useState<Tab>('swap');

  return (
    <div style={{ maxWidth: 1360, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 320px', gap: 20, alignItems: 'start' }}>

        {/* Left — collateral deposit/withdraw */}
        <div style={{ position: 'sticky', top: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <CollateralSidebar />
        </div>

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

          <div style={{ display: 'grid' }}>
            <div style={{ gridArea: '1/1', visibility: tab === 'swap'     ? 'visible' : 'hidden', pointerEvents: tab === 'swap'     ? 'auto' : 'none', minWidth: 0 }}><InitiateSwapSection /></div>
            <div style={{ gridArea: '1/1', visibility: tab === 'settle'   ? 'visible' : 'hidden', pointerEvents: tab === 'settle'   ? 'auto' : 'none', minWidth: 0 }}><SettleSection /></div>
            <div style={{ gridArea: '1/1', visibility: tab === 'swaption' ? 'visible' : 'hidden', pointerEvents: tab === 'swaption' ? 'auto' : 'none', minWidth: 0 }}><SwaptionSection /></div>
          </div>

          <SwapTable />
        </div>

        {/* Right — account + collateral + mint */}
        <div style={{ position: 'sticky', top: 32 }}>
          <AccountSection />
        </div>
      </div>
    </div>
  );
}
