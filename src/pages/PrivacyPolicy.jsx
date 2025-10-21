import React from 'react';
import { Navbar } from '../components/Navbar';

export default function PrivacyPolicy() {
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
                Privacy Policy
              </h1>
              <p className="text-purple-300 text-lg">Effective Date: October 2025</p>
            </div>

            <div className="prose prose-lg prose-invert max-w-none space-y-6 text-gray-300">
              <p className="text-white">
                This Privacy Policy (the "Policy") explains how LexieAI Ltd. ("LexieAI", "we", "us" or "our") collects, uses, discloses and protects personal data in connection with the LexieAI website, mobile application, browser extension and any other products or services that link to this Policy (collectively, the "Services"). By accessing or using the Services, you agree to the terms of this Policy and our Terms & Conditions. If you do not agree, please do not use the Services.
              </p>

              <p className="text-white">
                LexieAI is committed to minimising the personal data we collect and to protecting your privacy. We operate our Services in a privacy‑conscious manner similar to other decentralised finance projects. Like the 1inch network, we "design our services to minimize the collection of personal data wherever possible" and, when data collection is necessary, we apply appropriate safeguards to handle your information securely. This Policy details how and why we process information about you.
              </p>

              <div className="space-y-8">
                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">1. Identity of the Data Controller</h2>
                  <p>LexieAI Ltd., a company incorporated in the British Virgin Islands, acts as the data controller for the personal data processed through the Services. You can contact us via the email listed in the "Contact" section below.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">2. Data We Collect</h2>
                  <p className="mb-4">We seek to collect as little personal data as practicable while providing our Services. Depending on how you interact with LexieAI, we may collect the following categories of data:</p>

                  <h3 className="text-xl font-semibold text-purple-200 mb-3">2.1 Data You Voluntarily Provide</h3>
                  <div className="space-y-4 ml-4">
                    <div>
                      <strong className="text-white">Wallet Address</strong> – When you connect a self‑custodial wallet to the Services, we may collect your public blockchain address. Like Uniswap Labs and Aave, we consider wallet addresses public on‑chain data and may log this information to facilitate service delivery, screen wallets for sanctions or illicit activity, and detect fraud. We do not have access to your private keys or wallet seed phrases, and we will never ask you to share them.
                    </div>
                    <div>
                      <strong className="text-white">LexieID and Telegram ID</strong> – If you choose to create a LexieID or link your Telegram account, we may collect your chosen username and associated Telegram identifier. This allows us to provide the LexieID service, process referrals and enable social interactions.
                    </div>
                    <div>
                      <strong className="text-white">Contact Information and Correspondence</strong> – If you contact us for support, subscribe to newsletters, participate in surveys, or otherwise provide contact details, we may collect your name, email address, job title and the content of your communications. This helps us respond to your requests and keep you informed.
                    </div>
                    <div>
                      <strong className="text-white">Referral Information</strong> – We may collect the LexieID of the person who referred you and any points or rewards associated with the referral.
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold text-purple-200 mb-3 mt-6">2.2 Data Collected Automatically</h3>
                  <p className="mb-3">We may automatically collect certain non‑identifiable information through cookies, local storage or similar technologies when you access the Services. This type of data may include:</p>
                  <div className="space-y-4 ml-4">
                    <div>
                      <strong className="text-white">Device and Usage Information</strong> – We may collect information about the device you use to access the Services (e.g., device type, operating system, browser type and screen dimensions) and how you interact with the Services (e.g., pages visited, features used, taps, clicks, and scrolls). Aave, for example, collects device type and usage information to optimize its interface. We use similar information to improve the Services and troubleshoot issues.
                    </div>
                    <div>
                      <strong className="text-white">IP Address and Log Data</strong> – Like 1inch and Uniswap, we may collect IP addresses, browser type, Internet Service Provider (ISP) information, date/time stamps and referring pages. This data helps with performance, security, analytics and detecting potential fraud.
                    </div>
                    <div>
                      <strong className="text-white">Analytics Data</strong> – We may use analytics providers (e.g., Google Analytics, Mixpanel) to analyse user behaviour, track usage patterns and improve our products. These providers may collect device and usage information via cookies or similar technologies. You can opt out of analytics by disabling cookies in your browser settings or via any opt‑out mechanisms we provide.
                    </div>
                    <div>
                      <strong className="text-white">Cookies and Local Storage</strong> – Our Services may use cookies, localStorage, web beacons or similar technologies to remember preferences (e.g., tokens imported or starred), maintain sessions and personalise your experience. Cookies are small text files stored on your device. You can manage cookie preferences through your browser settings; however, disabling cookies may affect the Services' functionality.
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold text-purple-200 mb-3 mt-6">2.3 Third‑Party Services</h3>
                  <p>We integrate third‑party services into the Services, such as Cloudflare for performance and security, remote procedure call (RPC) providers to interact with specific blockchains, analytics providers and mailing services (e.g., Beehiiv). These partners may collect certain information (such as IP addresses or device information) necessary to deliver their services. We recommend reviewing the privacy policies of these providers. LexieAI is not responsible for the data practices of third parties.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">3. How We Use Data</h2>
                  <p className="mb-3">We use the data we collect for various purposes. Our primary purposes include:</p>
                  <div className="space-y-3 ml-4">
                    <div>
                      <strong className="text-white">Providing and Operating the Services</strong> – To create and maintain your LexieVault, issue LexieID, process transactions and maintain your LexiePoints balance. This includes using wallet addresses and LexieID to execute transfers and referrals. Uniswap, for example, uses data to provide, maintain and customize its services.
                    </div>
                    <div>
                      <strong className="text-white">Security and Fraud Prevention</strong> – To monitor for suspicious activity, prevent fraud, investigate misuse of the Services and comply with sanctions screening and other legal requirements. This may involve screening wallet addresses and IP addresses against sanction lists and using analytics to detect illicit activity.
                    </div>
                    <div>
                      <strong className="text-white">Compliance and Legal Obligations</strong> – To comply with applicable laws, lawful requests and our regulatory obligations. We may use your information to respond to subpoenas, court orders or other legal processes.
                    </div>
                    <div>
                      <strong className="text-white">Improving the Services</strong> – To analyse usage trends, debug issues, research, develop new features, optimise the user interface and otherwise enhance your experience. We may aggregate or de‑identify data for internal research and statistical purposes.
                    </div>
                    <div>
                      <strong className="text-white">Customer Support</strong> – To respond to your inquiries, issues or feedback. Aave similarly collects correspondence to improve the services.
                    </div>
                    <div>
                      <strong className="text-white">Marketing and Communication</strong> – If you subscribe to our newsletter or other updates, we may send you information about LexieAI products, services and features. You can opt out at any time.
                    </div>
                  </div>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">4. Sharing and Disclosure</h2>
                  <p className="mb-3">LexieAI does not sell your personal information. We may share data in the following circumstances:</p>
                  <div className="space-y-3 ml-4">
                    <div>
                      <strong className="text-white">Service Providers</strong> – We share information with third‑party service providers that assist us in delivering the Services, such as analytics providers, hosting companies, RPC providers, security platforms, mailing services and customer support platforms. For example, Uniswap may share wallet addresses with Cloudflare or analytics providers. These providers may only use your information as necessary to perform their functions.
                    </div>
                    <div>
                      <strong className="text-white">Legal and Compliance</strong> – We may disclose information when required by law, regulation or legal process; to comply with our obligations; to protect the safety, rights or property of LexieAI, our users or others; or to investigate fraud or wrongdoing.
                    </div>
                    <div>
                      <strong className="text-white">Business Transfers</strong> – In the event of a merger, acquisition, financing, reorganisation or sale of all or part of our business, data may be transferred as part of that transaction.
                    </div>
                    <div>
                      <strong className="text-white">Aggregated or De‑identified Data</strong> – We may share aggregated or de‑identified data that cannot reasonably identify you. This data may be used for analytics, research or marketing purposes.
                    </div>
                  </div>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">5. International Transfers</h2>
                  <p>LexieAI is incorporated in the British Virgin Islands. We and our service providers may process your data in countries outside your jurisdiction, including countries that may not provide the same level of data protection as your home country. We will take steps to ensure appropriate safeguards are in place, such as contractual protections or other mechanisms recognised under applicable data‑protection laws.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">6. Data Retention</h2>
                  <p>We retain personal data only for as long as necessary to provide the Services and fulfill the purposes described in this Policy, unless a longer retention period is required or permitted by law. When data is no longer needed, we will de‑identify or delete it in a secure manner.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">7. Your Rights and Choices</h2>
                  <p className="mb-3">Depending on your jurisdiction, you may have certain rights regarding your personal data, including:</p>
                  <div className="space-y-2 ml-4">
                    <div><strong className="text-white">Access and Portability</strong> – You may request a copy of the personal data we hold about you.</div>
                    <div><strong className="text-white">Correction</strong> – You may request that we correct or update your personal information.</div>
                    <div><strong className="text-white">Deletion</strong> – You may request that we delete your personal data, subject to certain exceptions (e.g., where the information is required for compliance or legal reasons).</div>
                    <div><strong className="text-white">Object or Restrict Processing</strong> – You may object to or request that we restrict certain processing activities.</div>
                    <div><strong className="text-white">Withdraw Consent</strong> – Where processing is based on consent, you may withdraw your consent at any time.</div>
                  </div>
                  <p className="mt-3">To exercise any of these rights, please contact us via the email provided below. We may need to verify your identity to process your request. If you are located in the European Economic Area (EEA) or the United Kingdom, you may also lodge a complaint with your local data‑protection authority.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">8. Children's Privacy</h2>
                  <p>Our Services are not directed to children under the age of 13 (or older if required by local law). We do not knowingly collect personal information from children. If you become aware that a child has provided us with personal data, please contact us. We will take steps to remove the information and terminate the child's access to the Services.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">9. Security</h2>
                  <p>LexieAI takes reasonable and appropriate technical and organisational measures to protect your personal information from unauthorised access, loss, misuse or alteration. These measures include encryption, secure protocols, firewalls and regular security assessments. However, no security system is perfect. We cannot guarantee that your information is completely safe from hackers, malware or other threats. You are responsible for maintaining the security of your wallet credentials and devices.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">10. Changes to this Policy</h2>
                  <p>We may update this Privacy Policy from time to time. We will post the updated Policy on our website and indicate the "Effective Date" at the top. Changes will take effect immediately upon posting. Your continued use of the Services after the update constitutes your acceptance of the revised Policy.</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-purple-300 mb-4">11. Contact Us</h2>
                  <p>If you have questions or concerns regarding this Privacy Policy or our data practices, please contact us at <a href="mailto:admin@lexiecrypto.com" className="text-purple-300 hover:text-purple-200 transition-colors">admin@lexiecrypto.com</a>. We will make reasonable efforts to respond promptly.</p>
                </section>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
