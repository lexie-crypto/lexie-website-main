import React from 'react';
import { Navbar } from '../components/Navbar';

export default function TermsAndConditions() {
  return (
    <>
      <Navbar />

      <main className="relative min-h-screen bg-black text-white">
        {/* Background */}
        <div className="fixed inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-br from-black via-purple-900/30 to-blue-900/20"></div>
          <div className="absolute inset-0 opacity-30">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(147,51,234,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(147,51,234,0.2)_1px,transparent_1px)] bg-[size:40px_40px] animate-pulse"></div>
            <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.1)_1px,transparent_1px)] bg-[size:80px_80px] animate-pulse" style={{animationDelay: '1s'}}></div>
          </div>
        </div>

        <div className="relative z-10 max-w-4xl mx-auto px-6 py-20">
          <div className="bg-black/60 backdrop-blur-sm border border-purple-500/30 rounded-xl p-8 md:p-12">
            <div className="mb-8 text-center">
              <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent mb-4">
                Terms & Conditions
              </h1>
              <p className="text-purple-300 text-lg">Last Updated: October 2025</p>
            </div>

            <div className="prose prose-lg prose-invert max-w-none space-y-6 text-gray-300">
              <p className="text-white">
                Welcome to the LexieAI App ("LexieAI", "we", "our" or "us"). LexieAI is a suite of software tools – including a zk‑shielded vault, an AI chatbot, a gamified points system, and identity services – designed to help you interact with decentralised finance (DeFi) more safely and intuitively. These Terms & Conditions ("Terms") govern your access to and use of LexieAI's website, mobile application, interactive services and any other products or services that link to these Terms (collectively, the "Services"). By accessing or using the Services or by acknowledging agreement to the Terms on the Services, you agree that you have read, understood and accept all of the Terms and the LexieAI Privacy Policy. These Terms apply in addition to any other guidelines or policies that we post or provide.
              </p>

              <p className="text-white">
                LexieAI is operated by LexieAI Ltd., a limited liability company registered in the British Virgin Islands. Throughout these Terms, "you" and "user(s)" refer to anyone who accesses or uses the Services. If you are accessing or using the Services on behalf of a company or other legal entity, you represent that you have authority to bind that entity to these Terms and, in that case, "you" will refer to that entity.
              </p>

              <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
                <p className="text-red-300 font-semibold text-sm mb-2">⚠️ IMPORTANT NOTICE</p>
                <p className="text-red-200">
                  LexieAI does not control the blockchain, does not take custody of your crypto‑assets, and is not a regulated financial institution. All transactions involving digital assets are recorded on decentralised networks we do not control. You are solely responsible for safeguarding your private keys, for understanding the risks of digital assets, and for complying with all applicable laws and regulations. The Services are provided on an "as is" and "as available" basis without warranties of any kind, and your use of the Services is at your own risk.
                </p>
              </div>

              <div className="space-y-8">
                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">1. Products</h2>
                  <p className="mb-4">LexieAI offers the following products:</p>

                  <div className="space-y-3 ml-4">
                    <div>
                      <strong className="text-white">LexieVault</strong> – a website‑ and browser‑based interface that enables users to create a zk‑shielded non‑custodial vault to store supported tokens securely. The Vault uses zero‑knowledge proofs to shield balances and transaction history; however, it is non‑custodial – you remain in control of your private keys, and you alone can authorise transactions.
                    </div>
                    <div>
                      <strong className="text-white">LexieChat</strong> – an AI‑powered conversational interface that provides market insights, technical analysis and educational content. LexieChat can answer questions about crypto markets, protocols, DeFi mechanisms and LexieAI's services. LexieChat does not provide personalised financial, legal or tax advice.
                    </div>
                    <div>
                      <strong className="text-white">LexieTitans & Points</strong> – a gamified "tap‑to‑earn" experience in which you charge a digital Titan and earn LexiePoints that can later be redeemed for rewards. Points can also be earned by using the Vault and referring new users.
                    </div>
                    <div>
                      <strong className="text-white">LexieID</strong> – a human‑readable username linked to your wallet and Vault. LexieID simplifies transfers and social interactions within the LexieAI ecosystem.
                    </div>
                  </div>

                  <p className="mt-4">We may, from time to time, add new features or discontinue existing ones. Using any part of the Services constitutes acceptance of these Terms.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">2. Acceptance and Changes</h2>
                  <p>By accessing or using the Services, you acknowledge that you have read, understood and agree to be bound by these Terms and the Privacy Policy. If you do not agree, do not access or use the Services.</p>
                  <p>We may update these Terms at any time. When we do, we will post a revised version with an updated date. The revised Terms will apply on a going‑forward basis from the time of posting. If you disagree with any changes, your sole remedy is to stop using the Services.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">3. Eligibility</h2>
                  <p className="mb-3">To use the Services, you must satisfy the following requirements:</p>
                  <div className="space-y-2 ml-4">
                    <div><strong className="text-white">Age</strong> – you must be at least 18 years old (or the legal age of majority in your jurisdiction). By using the Services, you represent that you meet this requirement.</div>
                    <div><strong className="text-white">Legal Compliance</strong> – you may not use the Services if you are prohibited from doing so under applicable law, including sanctions regulations. In particular, the Services are not offered to persons or entities located or incorporated in jurisdictions that are subject to comprehensive trade or economic sanctions, embargoes or similar restrictive measures ("Prohibited Jurisdictions"). We do not make exceptions, and attempting to use a VPN or other means to circumvent geographical restrictions is prohibited.</div>
                    <div><strong className="text-white">Restricted Persons</strong> – you may not use the Services if you or your organisation appear on any sanctions or specially designated persons lists, or if you are otherwise designated a "Restricted Person".</div>
                  </div>
                  <p className="mt-3">You are solely responsible for understanding and complying with all laws and regulations that apply to you and your use of the Services.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">4. Accounts and Security</h2>
                  <p>LexieAI does not require you to create an account. You may connect a self‑custodial wallet (such as MetaMask) to the Services in order to interact with the Vault and other features. When you connect a wallet, you represent that you are the lawful owner of that wallet and associated private keys. LexieAI does not store, hold or have access to your private keys. You are solely responsible for safeguarding your private keys and any recovery phrases. If you lose access to your wallet, we cannot recover your assets.</p>
                  <p>Users may optionally register a LexieID by linking their wallet and Telegram account. You agree to provide accurate, current and complete information and to keep it updated. You must not impersonate another person or violate their rights. We reserve the right to reclaim usernames or LexieIDs at our sole discretion.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">5. Use of the Services</h2>

                  <h3 className="text-xl font-semibold text-purple-200 mb-3">5.1 Permitted Use</h3>
                  <p>You may use the Services only for lawful purposes. You must not use the Services to engage in any activity that is illegal, harmful, abusive, fraudulent, misleading or otherwise inappropriate, including:</p>
                  <ul className="list-disc ml-6 mt-2 space-y-1">
                    <li>Violating applicable laws, regulations or court orders;</li>
                    <li>Infringing intellectual property or other proprietary rights;</li>
                    <li>Interfering with the operation of the Services or any networks or systems connected to the Services;</li>
                    <li>Engaging in market manipulation, fraud, rug‑pulls or other illegal or unethical schemes;</li>
                    <li>Transmitting viruses, malware, or other harmful code;</li>
                    <li>Attempting to circumvent restrictions, such as using VPNs to access the Services from Prohibited Jurisdictions.</li>
                  </ul>

                  <h3 className="text-xl font-semibold text-purple-200 mb-3 mt-6">5.2 Third‑Party Services</h3>
                  <p>Some features of the Services may enable you to interact with smart contracts, protocols, liquidity pools, or other third‑party services ("Third‑Party Services"). These are not under our control, and we are not responsible for their operation or outcomes. Your use of Third‑Party Services is subject to their own terms and conditions. We encourage you to review those terms carefully.</p>

                  <h3 className="text-xl font-semibold text-purple-200 mb-3 mt-6">5.3 Transactions and Gas Fees</h3>
                  <p>All transactions involving digital assets occur on decentralised blockchain networks that we do not own or control. We cannot and do not guarantee that any transaction submitted via the Services will be executed. You acknowledge that transactions may fail or be delayed due to network congestion, forks, or other issues beyond our control. You are solely responsible for paying any network fees (commonly known as "gas") required to execute transactions on a blockchain network.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">6. Risks and Disclaimers</h2>

                  <h3 className="text-xl font-semibold text-purple-200 mb-3">6.1 No Financial Advice</h3>
                  <p>Information provided through LexieChat, LexieTitans, or any other component of the Services is for informational purposes only. LexieAI is not a broker, financial advisor or fiduciary and does not provide personalised investment, financial, legal or tax advice. Any opinions, news, analysis or technical indicators are general in nature and should not be relied upon for making investment decisions. You are solely responsible for your own financial decisions.</p>

                  <h3 className="text-xl font-semibold text-purple-200 mb-3 mt-6">6.2 Volatility and Market Risk</h3>
                  <p>Digital assets are highly volatile. Market values may fluctuate significantly and unpredictably. Screening tools or risk alerts we provide are for informational purposes and may not be complete, accurate or current. You remain responsible for conducting your own due diligence and understanding the risks of interacting with any digital asset. You acknowledge and agree that all such interactions are undertaken at your sole risk, and you release us from any claims or damages arising from those interactions.</p>

                  <h3 className="text-xl font-semibold text-purple-200 mb-3 mt-6">6.3 No Custody</h3>
                  <p>LexieAI is non‑custodial. We do not receive, store, transfer, escrow, safeguard or otherwise take possession or control of your digital assets, wallets or private keys. You keep full control of your keys and assets, and you are responsible for securing them. If you lose your private keys or fail to maintain security, you may permanently lose access to your assets. LexieAI is not responsible for any such losses.</p>

                  <h3 className="text-xl font-semibold text-purple-200 mb-3 mt-6">6.4 Disclaimer of Warranties</h3>
                  <p>Your use of the Services is at your sole risk. We make no representations or warranties, express or implied, about the Services or any information provided through them. Without limiting this disclaimer, we expressly do not warrant that the Services or any related software or content (a) will be error‑free or free from defects; (b) will meet your requirements; or (c) will be secure, uninterrupted or available at any particular time or location. The Services are provided on an "as is" and "as available" basis.</p>

                  <h3 className="text-xl font-semibold text-purple-200 mb-3 mt-6">6.5 Limitation of Liability</h3>
                  <p>To the maximum extent permitted by law, LexieAI and its affiliates, directors, officers, employees, contractors, agents and service providers are not liable to you for any indirect, punitive, incidental, special, consequential or exemplary damages, including loss of profits, goodwill, data or other intangible property arising from or relating to your access to or use of the Services or any Third‑Party Services. Our total liability to you for all claims under these Terms will not exceed the amount you paid us (if any) for accessing the Services or $100, whichever is greater.</p>

                  <h3 className="text-xl font-semibold text-purple-200 mb-3 mt-6">6.6 Indemnification</h3>
                  <p>You agree to hold harmless, release, defend and indemnify LexieAI and its affiliates (together, the "LexieAI Parties") from and against any and all claims, damages, losses, liabilities, costs and expenses (including reasonable attorneys' fees) arising from or relating to: (a) your use of the Services or any Third‑Party Services; (b) your violation of these Terms or any applicable law or regulation; (c) any third party's use of the Services through your devices, accounts or credentials; and (d) any dispute between you and another user or a third party.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">7. Intellectual Property</h2>
                  <p>LexieAI owns all intellectual property rights in the Services, including software, text, graphics, trademarks, logos and designs. Accessing the Services does not grant you any ownership rights. You may not copy, modify, distribute, license, sell or otherwise exploit any part of the Services without our prior written consent. You retain ownership of any content you submit, but by uploading it you grant LexieAI a worldwide, royalty‑free licence to use, reproduce and distribute that content to operate the Services.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">8. Points, Referrals and Airdrops</h2>
                  <p>LexiePoints have no monetary value outside of LexieAI's ecosystem and may not be exchanged for currency. Points may be redeemed for rewards or benefits that we choose to offer. We reserve the right to change the points system, adjust earning rates, or discontinue the programme at any time. Referral rewards are subject to verification and may be revoked if we suspect fraud or abuse.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">9. Termination</h2>
                  <p>We may suspend or terminate your access to the Services at our sole discretion, without notice or liability, for any reason including your breach of these Terms, fraudulent activity or misuse of the Services. Upon termination, all rights granted to you under these Terms will immediately cease. Sections that by their nature should survive termination will remain in effect, including Sections 6 (Risks & Disclaimers), 6.5 (Limitation of Liability), 6.6 (Indemnification), 7 (Intellectual Property) and 11 (Governing Law & Dispute Resolution).</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">10. Modifications and Availability</h2>
                  <p>We may modify or discontinue any part of the Services at any time without liability. We may from time to time correct errors, update information or otherwise modify the Services. We have no obligation to maintain or support any aspect of the Services.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">11. Governing Law & Dispute Resolution</h2>
                  <p>These Terms and any disputes arising out of or in connection with them will be governed by and construed in accordance with the laws of the British Virgin Islands. The courts of the British Virgin Islands shall have exclusive jurisdiction to settle any dispute or claim relating to these Terms. You consent to the personal jurisdiction of such courts.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">12. General Provisions</h2>

                  <div className="space-y-4">
                    <div>
                      <strong className="text-white">Entire Agreement</strong> – These Terms, together with any other policies or guidelines posted on the Services, constitute the entire agreement between you and LexieAI concerning the Services and supersede any prior agreements.
                    </div>
                    <div>
                      <strong className="text-white">Severability</strong> – If any provision of these Terms is determined to be invalid or unenforceable, the remaining provisions will remain in full force and effect, and the invalid provision will be replaced with a valid one that most closely matches the intent of the original provision.
                    </div>
                    <div>
                      <strong className="text-white">No Waiver</strong> – Our failure to enforce any right or provision of these Terms will not constitute a waiver of such right or provision.
                    </div>
                    <div>
                      <strong className="text-white">Assignment</strong> – You may not transfer or assign your rights or obligations under these Terms without our prior written consent. We may assign or transfer our rights or obligations at our discretion.
                    </div>
                    <div>
                      <strong className="text-white">Contact</strong> – If you have any questions about these Terms or the Services, you may contact us at <a href="mailto:admin@lexiecrypto.com" className="text-purple-300 hover:text-purple-200 transition-colors">admin@lexiecrypto.com</a>.
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
