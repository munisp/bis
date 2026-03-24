/**
 * Multi-Stakeholder Onboarding Wizard
 * =====================================
 * A dynamic, multi-step onboarding wizard that adapts its fields,
 * document requirements, and validation rules based on the entity type:
 *
 *  - Merchant / Tourism Operator
 *  - Financial Institution (Bank, PSP, MNO)
 *  - Government Agency (MDA)
 *  - NGO / Foundation
 *  - Individual (Director, Shareholder, UBO)
 *
 * Connects to the BIS Onboarding API via tRPC.
 * Supports document upload, director invitations, and real-time status tracking.
 */

import { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  Building2, User, FileText, Upload, CheckCircle2, Clock,
  AlertCircle, ChevronRight, ChevronLeft, Plus, Trash2,
  Mail, Phone, Globe, MapPin, Briefcase, Shield, Users,
  Send, RefreshCw, Download, Eye
} from 'lucide-react';
import BISLayout from '@/components/BISLayout';

// ─── Types ────────────────────────────────────────────────────────────────────

type EntityType = 'merchant' | 'financial_institution' | 'government_agency' | 'ngo' | 'individual';
type OnboardingStatus = 'draft' | 'awaiting_documents' | 'processing' | 'awaiting_stakeholders' | 'manual_review' | 'approved' | 'rejected';

interface Stakeholder {
  id?: string;
  role: string;
  fullName: string;
  email: string;
  phone: string;
  ownershipPercentage?: number;
  kycStatus?: string;
  invitationSent?: boolean;
}

interface DocumentUpload {
  type: string;
  name: string;
  file?: File;
  status: 'pending' | 'uploading' | 'uploaded' | 'verified' | 'rejected';
  required: boolean;
}

interface OnboardingForm {
  entityType: EntityType;
  legalName: string;
  tradingName: string;
  registrationNumber: string;
  taxId: string;
  countryCode: string;
  stateProvince: string;
  city: string;
  address: string;
  website: string;
  businessCategory: string;
  employeeCount: string;
  annualRevenue: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactTitle: string;
  useCase: string;
  expectedMonthlyVolume: string;
  pepDeclaration: boolean;
  agreedToTerms: boolean;
  // Individual-specific fields
  nin: string;
  bvn: string;
  dateOfBirth: string;
  occupation: string;
  gender: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTITY_TYPES = [
  { value: 'merchant', label: 'Merchant / Tourism Operator', icon: '🏨', description: 'Hotels, restaurants, tour guides, transport' },
  { value: 'financial_institution', label: 'Financial Institution', icon: '🏦', description: 'Banks, PSPs, Mobile Money Operators' },
  { value: 'government_agency', label: 'Government Agency', icon: '🏛️', description: 'Ministries, Departments, Agencies (MDAs)' },
  { value: 'ngo', label: 'NGO / Non-Profit', icon: '🤝', description: 'Charities, Foundations, Civil Society' },
  { value: 'individual', label: 'Individual / Consumer', icon: '👤', description: 'Individual KYC, domestic staff vetting, personal background check' },
];

const BUSINESS_CATEGORIES: Record<EntityType, Array<{value: string; label: string}>> = {
  merchant: [
    { value: 'hotel', label: 'Hotel' }, { value: 'restaurant', label: 'Restaurant' },
    { value: 'tour_operator', label: 'Tour Operator' }, { value: 'transport', label: 'Transport' },
    { value: 'safari_lodge', label: 'Safari Lodge' }, { value: 'beach_resort', label: 'Beach Resort' },
    { value: 'spa_wellness', label: 'Spa & Wellness' }, { value: 'museum', label: 'Museum' },
    { value: 'theme_park', label: 'Theme Park' }, { value: 'travel_agency', label: 'Travel Agency' },
    { value: 'conference_center', label: 'Conference Center' }, { value: 'nightclub', label: 'Nightclub' },
  ],
  financial_institution: [
    { value: 'commercial_bank', label: 'Commercial Bank' }, { value: 'microfinance', label: 'Microfinance Bank' },
    { value: 'psp', label: 'Payment Service Provider' }, { value: 'mno', label: 'Mobile Network Operator' },
    { value: 'fintech', label: 'Fintech Company' }, { value: 'forex_bureau', label: 'Forex Bureau' },
  ],
  government_agency: [
    { value: 'ministry', label: 'Ministry' }, { value: 'department', label: 'Department' },
    { value: 'agency', label: 'Agency' }, { value: 'commission', label: 'Commission' },
    { value: 'parastatal', label: 'Parastatal' }, { value: 'local_government', label: 'Local Government' },
  ],
  ngo: [
    { value: 'charity', label: 'Charity' }, { value: 'foundation', label: 'Foundation' },
    { value: 'civil_society', label: 'Civil Society Organisation' }, { value: 'trade_association', label: 'Trade Association' },
  ],
  individual: [],
};

const DOCUMENT_REQUIREMENTS: Record<EntityType, DocumentUpload[]> = {
  merchant: [
    { type: 'cac_certificate', name: 'Certificate of Incorporation', status: 'pending', required: true },
    { type: 'memart', name: 'Memorandum & Articles of Association', status: 'pending', required: true },
    { type: 'tax_clearance', name: 'Tax Clearance Certificate', status: 'pending', required: true },
    { type: 'proof_of_address', name: 'Proof of Business Address (Utility Bill, ≤90 days)', status: 'pending', required: true },
    { type: 'bank_statement', name: '6-Month Bank Statement', status: 'pending', required: true },
    { type: 'tourism_license', name: 'Tourism Board License', status: 'pending', required: false },
  ],
  financial_institution: [
    { type: 'central_bank_license', name: 'Central Bank License', status: 'pending', required: true },
    { type: 'cac_certificate', name: 'Certificate of Incorporation', status: 'pending', required: true },
    { type: 'aml_policy', name: 'AML/CFT Policy Document', status: 'pending', required: true },
    { type: 'audited_accounts', name: 'Audited Financial Statements (2 years)', status: 'pending', required: true },
    { type: 'board_resolution', name: 'Board Resolution for Platform Use', status: 'pending', required: true },
  ],
  government_agency: [
    { type: 'official_mandate', name: 'Official Mandate / Gazette', status: 'pending', required: true },
    { type: 'intro_letter', name: 'Letter of Introduction on Official Letterhead', status: 'pending', required: true },
    { type: 'authorized_signatory_id', name: 'ID of Authorized Signatory', status: 'pending', required: true },
  ],
  ngo: [
    { type: 'cac_part_c', name: 'CAC Registration (Part C)', status: 'pending', required: true },
    { type: 'constitution', name: 'Organisation Constitution', status: 'pending', required: true },
    { type: 'scuml_certificate', name: 'SCUML Certificate', status: 'pending', required: true },
    { type: 'board_of_trustees', name: 'List of Board of Trustees', status: 'pending', required: true },
  ],
  individual: [
    { type: 'government_id', name: 'Government-Issued ID (NIN / Passport / Voter Card)', status: 'pending', required: true },
    { type: 'proof_of_address', name: 'Proof of Address (Utility Bill, ≤90 days)', status: 'pending', required: true },
    { type: 'selfie', name: 'Liveness Selfie (taken via camera)', status: 'pending', required: true },
  ],
};

const STATUS_CONFIG: Record<OnboardingStatus, { label: string; color: string; icon: React.ReactNode; description: string }> = {
  draft: { label: 'Draft', color: 'bg-muted/500/20 text-muted-foreground', icon: <Clock className="w-4 h-4" />, description: 'Application is being filled out' },
  awaiting_documents: { label: 'Awaiting Documents', color: 'bg-amber-500/20 text-amber-400', icon: <Upload className="w-4 h-4" />, description: 'Please upload required documents' },
  processing: { label: 'Processing', color: 'bg-primary/20 text-blue-400', icon: <RefreshCw className="w-4 h-4 animate-spin" />, description: 'Documents are being verified by our AI engine' },
  awaiting_stakeholders: { label: 'Awaiting Directors', color: 'bg-purple-500/20 text-purple-400', icon: <Users className="w-4 h-4" />, description: 'Waiting for directors/shareholders to complete KYC' },
  manual_review: { label: 'Under Review', color: 'bg-orange-500/20 text-orange-400', icon: <Eye className="w-4 h-4" />, description: 'Compliance team is reviewing your application' },
  approved: { label: 'Approved ✓', color: 'bg-emerald-500/20 text-emerald-400', icon: <CheckCircle2 className="w-4 h-4" />, description: 'Your application has been approved' },
  rejected: { label: 'Rejected', color: 'bg-red-500/20 text-red-400', icon: <AlertCircle className="w-4 h-4" />, description: 'Application was not approved' },
};

const STEPS = [
  { id: 0, label: 'Entity Type', icon: <Building2 className="w-4 h-4" /> },
  { id: 1, label: 'Organisation', icon: <Briefcase className="w-4 h-4" /> },
  { id: 2, label: 'Contact', icon: <User className="w-4 h-4" /> },
  { id: 3, label: 'Stakeholders', icon: <Users className="w-4 h-4" /> },
  { id: 4, label: 'Documents', icon: <FileText className="w-4 h-4" /> },
  { id: 5, label: 'Review', icon: <Shield className="w-4 h-4" /> },
];

// ─── Main Component ───────────────────────────────────────────────────────────

function StakeholderOnboardingWizardInner() {
  const [step, setStep] = useState(0);
  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [status, setStatus] = useState<OnboardingStatus>('draft');
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [documents, setDocuments] = useState<DocumentUpload[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<OnboardingForm>({
    defaultValues: {
      countryCode: 'NG',
      pepDeclaration: false,
      agreedToTerms: false,
      nin: '',
      bvn: '',
      dateOfBirth: '',
      occupation: '',
      gender: ''
    }
  });

  const watchedEntityType = watch('entityType');

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleEntityTypeSelect = (type: EntityType) => {
    setEntityType(type);
    setValue('entityType', type);
    setDocuments(DOCUMENT_REQUIREMENTS[type].map(d => ({ ...d })));
    setStep(1);
  };

  const handleNext = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const handleBack = () => setStep(s => Math.max(s - 1, 0));

  const handleAddStakeholder = () => {
    setStakeholders(prev => [...prev, {
      role: 'director',
      fullName: '',
      email: '',
      phone: '',
      ownershipPercentage: 0,
    }]);
  };

  const handleRemoveStakeholder = (index: number) => {
    setStakeholders(prev => prev.filter((_, i) => i !== index));
  };

  const uploadDocumentMutation = trpc.onboarding.uploadDocument.useMutation({
    onSuccess: (result, vars) => {
      setDocuments(prev => prev.map(d =>
        d.type === vars.fileName.split('__')[0] ? { ...d, status: 'uploaded' } : d
      ));
      toast.success(`${result.name} uploaded successfully`);
    },
    onError: (e) => {
      toast.error(`Upload failed: ${e.message}`);
      setDocuments(prev => prev.map(d =>
        d.status === 'uploading' ? { ...d, status: 'pending' } : d
      ));
    },
  });

  const handleDocumentUpload = useCallback((docType: string, file: File) => {
    if (!applicationId) {
      // Queue locally before application is created — will upload after submit
      setDocuments(prev => prev.map(d =>
        d.type === docType ? { ...d, file, status: 'pending' } : d
      ));
      toast.info(`${file.name} queued — will upload on submission`);
      return;
    }
    setDocuments(prev => prev.map(d =>
      d.type === docType ? { ...d, file, status: 'uploading' } : d
    ));
    // Read file as base64 and upload via tRPC
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUri = e.target?.result as string;
      uploadDocumentMutation.mutate({
        applicationId: parseInt(applicationId, 10),
        fileName: `${docType}__${file.name}`,
        fileDataUri: dataUri,
        mimeType: file.type || 'application/octet-stream',
      });
    };
    reader.readAsDataURL(file);
  }, [applicationId, uploadDocumentMutation]);

  const createOnboarding = trpc.onboarding.create.useMutation({
    onSuccess: (record) => {
      setApplicationId(String(record.id));
      setReferenceId(record.referenceId);
      setStatus('awaiting_documents');
      setStep(5);
      toast.success('Application submitted successfully!');
      setSubmitting(false);
      // Upload any documents that were queued before submission
      const queued = documents.filter(d => d.file && d.status === 'pending');
      queued.forEach(d => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUri = e.target?.result as string;
          uploadDocumentMutation.mutate({
            applicationId: record.id,
            fileName: `${d.type}__${d.file!.name}`,
            fileDataUri: dataUri,
            mimeType: d.file!.type || 'application/octet-stream',
          });
        };
        reader.readAsDataURL(d.file!);
      });
    },
    onError: (e) => {
      toast.error(`Failed to submit application: ${e.message}`);
      setSubmitting(false);
    },
  });

  const handleSubmitApplication = (data: OnboardingForm) => {
    if (!data.agreedToTerms) {
      toast.error('Please agree to the Terms and Conditions');
      return;
    }
    setSubmitting(true);
    createOnboarding.mutate({
      entityType: data.entityType,
      legalName: data.legalName,
      tradingName: data.tradingName,
      countryCode: data.countryCode,
      stateProvince: data.stateProvince,
      city: data.city,
      address: data.address,
      website: data.website,
      businessCategory: data.businessCategory,
      contactName: data.contactName,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      contactTitle: data.contactTitle,
      useCase: data.useCase,
      pepDeclaration: data.pepDeclaration,
      agreedToTerms: data.agreedToTerms,
      stakeholders: stakeholders.filter(s => s.fullName).map(s => ({
        role: s.role,
        fullName: s.fullName,
        email: s.email,
        phone: s.phone,
        ownershipPercentage: s.ownershipPercentage,
      })),
    });
  };

  // ── Progress ─────────────────────────────────────────────────────────────────

  const progressPercent = ((step) / (STEPS.length - 1)) * 100;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Stakeholder Onboarding</h1>
          <p className="text-muted-foreground">Register your organisation or complete your individual KYC</p>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            {STEPS.map((s, i) => (
              <div
                key={s.id}
                className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                  i <= step ? 'text-emerald-400' : 'text-muted-foreground'
                }`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center border transition-colors ${
                  i < step ? 'bg-emerald-500 border-emerald-500 text-foreground' :
                  i === step ? 'border-emerald-400 text-emerald-400' :
                  'border-border text-muted-foreground'
                }`}>
                  {i < step ? <CheckCircle2 className="w-4 h-4" /> : s.icon}
                </div>
                <span className="hidden md:block">{s.label}</span>
              </div>
            ))}
          </div>
          <Progress value={progressPercent} className="h-1.5 bg-muted" />
        </div>

        {/* ── Step 0: Entity Type Selection ── */}
        {step === 0 && (
          <div>
            <h2 className="text-xl font-semibold text-foreground mb-2">What type of organisation are you?</h2>
            <p className="text-muted-foreground text-sm mb-6">Select the option that best describes your entity. This determines the required documents and onboarding flow.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ENTITY_TYPES.map(et => (
                <button
                  key={et.value}
                  onClick={() => handleEntityTypeSelect(et.value as EntityType)}
                  className="flex items-start gap-4 p-5 rounded-xl border border-border bg-card hover:border-emerald-500/50 hover:bg-muted transition-all text-left group"
                >
                  <span className="text-3xl">{et.icon}</span>
                  <div>
                    <div className="font-semibold text-foreground group-hover:text-emerald-400 transition-colors">{et.label}</div>
                    <div className="text-sm text-muted-foreground mt-0.5">{et.description}</div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-emerald-400 ml-auto mt-0.5 transition-colors" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 1: Organisation Details ── */}
        {step === 1 && entityType === 'individual' && (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <User className="w-5 h-5 text-emerald-400" />
                Personal Details
              </CardTitle>
              <CardDescription>
                Complete your personal KYC. All information is encrypted and processed in accordance with NDPR.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Full Legal Name *</Label>
                  <Input
                    {...register('legalName', { required: 'Full name is required' })}
                    placeholder="As it appears on your NIN / Passport"
                    className="bg-muted border-border text-foreground mt-1"
                  />
                  {errors.legalName && <p className="text-red-400 text-xs mt-1">{errors.legalName.message}</p>}
                </div>
                <div>
                  <Label className="text-muted-foreground">Date of Birth *</Label>
                  <Input
                    {...register('dateOfBirth', { required: 'Date of birth is required' })}
                    type="date"
                    className="bg-muted border-border text-foreground mt-1"
                  />
                </div>
                <div>
                  <Label className="text-muted-foreground">NIN (National Identification Number)</Label>
                  <Input
                    {...register('nin')}
                    placeholder="11-digit NIN"
                    maxLength={11}
                    className="bg-muted border-border text-foreground mt-1"
                  />
                </div>
                <div>
                  <Label className="text-muted-foreground">BVN (Bank Verification Number)</Label>
                  <Input
                    {...register('bvn')}
                    placeholder="11-digit BVN"
                    maxLength={11}
                    className="bg-muted border-border text-foreground mt-1"
                  />
                </div>
                <div>
                  <Label className="text-muted-foreground">Gender</Label>
                  <Select onValueChange={v => setValue('gender' as any, v)}>
                    <SelectTrigger className="bg-muted border-border text-foreground mt-1">
                      <SelectValue placeholder="Select gender" />
                    </SelectTrigger>
                    <SelectContent className="bg-muted border-border">
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-muted-foreground">Nationality</Label>
                  <Select onValueChange={v => setValue('countryCode', v)} defaultValue="NG">
                    <SelectTrigger className="bg-muted border-border text-foreground mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-muted border-border">
                      <SelectItem value="NG">🇳🇬 Nigeria</SelectItem>
                      <SelectItem value="GH">🇬🇭 Ghana</SelectItem>
                      <SelectItem value="KE">🇰🇪 Kenya</SelectItem>
                      <SelectItem value="ZA">🇿🇦 South Africa</SelectItem>
                      <SelectItem value="GB">🇬🇧 United Kingdom</SelectItem>
                      <SelectItem value="US">🇺🇸 United States</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-muted-foreground">State of Origin</Label>
                  <Input
                    {...register('stateProvince')}
                    placeholder="e.g. Lagos, Kano, Abuja FCT"
                    className="bg-muted border-border text-foreground mt-1"
                  />
                </div>
                <div>
                  <Label className="text-muted-foreground">Occupation</Label>
                  <Input
                    {...register('occupation' as any)}
                    placeholder="e.g. Engineer, Trader, Civil Servant"
                    className="bg-muted border-border text-foreground mt-1"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-muted-foreground">Residential Address *</Label>
                  <Input
                    {...register('address')}
                    placeholder="House number, street, area, city"
                    className="bg-muted border-border text-foreground mt-1"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-muted-foreground">Purpose of Registration</Label>
                  <Select onValueChange={v => setValue('useCase', v)}>
                    <SelectTrigger className="bg-muted border-border text-foreground mt-1">
                      <SelectValue placeholder="Why are you registering?" />
                    </SelectTrigger>
                    <SelectContent className="bg-muted border-border">
                      <SelectItem value="personal_background_check">Personal background check</SelectItem>
                      <SelectItem value="vet_domestic_staff">Vet domestic staff (house help, driver, nanny)</SelectItem>
                      <SelectItem value="vet_contractor">Vet contractor / artisan</SelectItem>
                      <SelectItem value="director_kyc">Complete KYC as company director / UBO</SelectItem>
                      <SelectItem value="investor_kyc">Investor / shareholder KYC</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 1 && entityType && entityType !== 'individual' && (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <Building2 className="w-5 h-5 text-emerald-400" />
                Organisation Details
              </CardTitle>
              <CardDescription>
                {ENTITY_TYPES.find(e => e.value === entityType)?.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Legal Name *</Label>
                  <Input
                    {...register('legalName', { required: 'Legal name is required' })}
                    placeholder="As registered with CAC / government"
                    className="bg-muted border-border text-foreground mt-1"
                  />
                  {errors.legalName && <p className="text-red-400 text-xs mt-1">{errors.legalName.message}</p>}
                </div>
                <div>
                  <Label className="text-muted-foreground">Trading Name</Label>
                  <Input
                    {...register('tradingName')}
                    placeholder="If different from legal name"
                    className="bg-muted border-border text-foreground mt-1"
                  />
                </div>
                {entityType !== 'government_agency' && (
                  <>
                    <div>
                      <Label className="text-muted-foreground">Registration Number *</Label>
                      <Input
                        {...register('registrationNumber', { required: 'Registration number is required' })}
                        placeholder={entityType === 'ngo' ? 'CAC Part C Number' : 'CAC RC Number'}
                        className="bg-muted border-border text-foreground mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Tax ID (TIN)</Label>
                      <Input
                        {...register('taxId')}
                        placeholder="Federal Inland Revenue TIN"
                        className="bg-muted border-border text-foreground mt-1"
                      />
                    </div>
                  </>
                )}
                <div>
                  <Label className="text-muted-foreground">Country *</Label>
                  <Select onValueChange={v => setValue('countryCode', v)} defaultValue="NG">
                    <SelectTrigger className="bg-muted border-border text-foreground mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-muted border-border">
                      <SelectItem value="NG">🇳🇬 Nigeria</SelectItem>
                      <SelectItem value="GH">🇬🇭 Ghana</SelectItem>
                      <SelectItem value="KE">🇰🇪 Kenya</SelectItem>
                      <SelectItem value="ZA">🇿🇦 South Africa</SelectItem>
                      <SelectItem value="TZ">🇹🇿 Tanzania</SelectItem>
                      <SelectItem value="UG">🇺🇬 Uganda</SelectItem>
                      <SelectItem value="RW">🇷🇼 Rwanda</SelectItem>
                      <SelectItem value="ET">🇪🇹 Ethiopia</SelectItem>
                      <SelectItem value="GB">🇬🇧 United Kingdom</SelectItem>
                      <SelectItem value="US">🇺🇸 United States</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-muted-foreground">State / Province</Label>
                  <Input
                    {...register('stateProvince')}
                    placeholder="e.g. Lagos, Abuja FCT"
                    className="bg-muted border-border text-foreground mt-1"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-muted-foreground">Business Address</Label>
                  <Input
                    {...register('address')}
                    placeholder="Full business address"
                    className="bg-muted border-border text-foreground mt-1"
                  />
                </div>
                {BUSINESS_CATEGORIES[entityType].length > 0 && (
                  <div>
                    <Label className="text-muted-foreground">Business Category</Label>
                    <Select onValueChange={v => setValue('businessCategory', v)}>
                      <SelectTrigger className="bg-muted border-border text-foreground mt-1">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent className="bg-muted border-border">
                        {BUSINESS_CATEGORIES[entityType].map(cat => (
                          <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label className="text-muted-foreground">Website</Label>
                  <Input
                    {...register('website')}
                    placeholder="https://yourwebsite.com"
                    className="bg-muted border-border text-foreground mt-1"
                  />
                </div>
                {entityType !== 'government_agency' && (
                  <>
                    <div>
                      <Label className="text-muted-foreground">Expected Monthly Volume (USD)</Label>
                      <Input
                        {...register('expectedMonthlyVolume')}
                        type="number"
                        placeholder="e.g. 50000"
                        className="bg-muted border-border text-foreground mt-1"
                      />
                    </div>
                  </>
                )}
                <div className="md:col-span-2">
                  <Label className="text-muted-foreground">Use Case / Purpose</Label>
                  <Textarea
                    {...register('useCase')}
                    placeholder="Describe how you intend to use the BIS platform..."
                    className="bg-muted border-border text-foreground mt-1"
                    rows={3}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Step 2: Contact Person ── */}
        {step === 2 && (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <User className="w-5 h-5 text-emerald-400" />
                Primary Contact
              </CardTitle>
              <CardDescription>The person responsible for this application</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Full Name *</Label>
                  <Input
                    {...register('contactName', { required: 'Contact name is required' })}
                    placeholder="First and last name"
                    className="bg-muted border-border text-foreground mt-1"
                  />
                </div>
                <div>
                  <Label className="text-muted-foreground">Job Title</Label>
                  <Input
                    {...register('contactTitle')}
                    placeholder="e.g. CEO, Compliance Officer"
                    className="bg-muted border-border text-foreground mt-1"
                  />
                </div>
                <div>
                  <Label className="text-muted-foreground">Email Address *</Label>
                  <Input
                    {...register('contactEmail', { required: 'Email is required', pattern: { value: /\S+@\S+\.\S+/, message: 'Invalid email' } })}
                    type="email"
                    placeholder="contact@company.com"
                    className="bg-muted border-border text-foreground mt-1"
                  />
                  {errors.contactEmail && <p className="text-red-400 text-xs mt-1">{errors.contactEmail.message}</p>}
                </div>
                <div>
                  <Label className="text-muted-foreground">Phone Number</Label>
                  <Input
                    {...register('contactPhone')}
                    placeholder="+234 801 234 5678"
                    className="bg-muted border-border text-foreground mt-1"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Step 3: Stakeholders (Directors / Shareholders) ── */}
        {step === 3 && entityType !== 'individual' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Directors & Shareholders</h2>
                <p className="text-muted-foreground text-sm mt-1">
                  Add all directors and shareholders with ≥10% ownership. Each will receive an invitation to complete their individual KYC.
                </p>
              </div>
              <Button onClick={handleAddStakeholder} variant="outline" size="sm" className="border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10">
                <Plus className="w-4 h-4 mr-1" /> Add Person
              </Button>
            </div>

            {stakeholders.length === 0 && (
              <div className="border border-dashed border-border rounded-xl p-8 text-center">
                <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">No stakeholders added yet.</p>
                <p className="text-muted-foreground text-xs mt-1">Click "Add Person" to add directors and shareholders.</p>
              </div>
            )}

            {stakeholders.map((s, i) => (
              <Card key={i} className="bg-card border-border">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-muted-foreground">Person {i + 1}</span>
                    <button onClick={() => handleRemoveStakeholder(i)} className="text-red-400 hover:text-red-300">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-muted-foreground text-xs">Role</Label>
                      <Select
                        value={s.role}
                        onValueChange={v => setStakeholders(prev => prev.map((sh, j) => j === i ? { ...sh, role: v } : sh))}
                      >
                        <SelectTrigger className="bg-muted border-border text-foreground mt-1 h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-muted border-border">
                          <SelectItem value="director">Director</SelectItem>
                          <SelectItem value="shareholder">Shareholder</SelectItem>
                          <SelectItem value="ubo">Ultimate Beneficial Owner</SelectItem>
                          <SelectItem value="authorized_signatory">Authorized Signatory</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-2">
                      <Label className="text-muted-foreground text-xs">Full Name *</Label>
                      <Input
                        value={s.fullName}
                        onChange={e => setStakeholders(prev => prev.map((sh, j) => j === i ? { ...sh, fullName: e.target.value } : sh))}
                        placeholder="Full legal name"
                        className="bg-muted border-border text-foreground mt-1 h-9 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-muted-foreground text-xs">Email</Label>
                      <Input
                        value={s.email}
                        onChange={e => setStakeholders(prev => prev.map((sh, j) => j === i ? { ...sh, email: e.target.value } : sh))}
                        placeholder="email@example.com"
                        className="bg-muted border-border text-foreground mt-1 h-9 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-muted-foreground text-xs">Phone (WhatsApp)</Label>
                      <Input
                        value={s.phone}
                        onChange={e => setStakeholders(prev => prev.map((sh, j) => j === i ? { ...sh, phone: e.target.value } : sh))}
                        placeholder="+234 801 234 5678"
                        className="bg-muted border-border text-foreground mt-1 h-9 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-muted-foreground text-xs">Ownership %</Label>
                      <Input
                        type="number"
                        value={s.ownershipPercentage}
                        onChange={e => setStakeholders(prev => prev.map((sh, j) => j === i ? { ...sh, ownershipPercentage: Number(e.target.value) } : sh))}
                        placeholder="0-100"
                        min={0} max={100}
                        className="bg-muted border-border text-foreground mt-1 h-9 text-sm"
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="text-xs text-muted-foreground">Will receive a KYC invitation via {s.email ? 'email' : s.phone ? 'WhatsApp' : 'email/SMS'}</span>
                  </div>
                </CardContent>
              </Card>
            ))}

            <div className="bg-primary/10 border border-primary/20 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-blue-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-300">Director Bundle</p>
                  <p className="text-xs text-blue-400/80 mt-1">
                    Each director/shareholder will receive a secure invitation link to complete their individual KYC (identity verification + liveness check). Your application will advance to compliance review once all required KYCs are completed.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 4: Document Upload ── */}
        {step === 4 && entityType && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Required Documents</h2>
              <p className="text-muted-foreground text-sm mt-1">Upload clear, high-resolution scans or photos of the following documents.</p>
            </div>

            {documents.map((doc) => (
              <div
                key={doc.type}
                className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
                  doc.status === 'uploaded' || doc.status === 'verified' ? 'border-emerald-500/30 bg-emerald-500/5' :
                  doc.status === 'rejected' ? 'border-red-500/30 bg-red-500/5' :
                  'border-border bg-card'
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{doc.name}</span>
                    {doc.required ? (
                      <span className="text-xs text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">Required</span>
                    ) : (
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Optional</span>
                    )}
                  </div>
                  {doc.file && (
                    <p className="text-xs text-muted-foreground mt-1">{doc.file.name} ({(doc.file.size / 1024).toFixed(0)} KB)</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {doc.status === 'uploading' && <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />}
                  {(doc.status === 'uploaded' || doc.status === 'verified') && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  {doc.status === 'rejected' && <AlertCircle className="w-4 h-4 text-red-400" />}
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={e => e.target.files?.[0] && handleDocumentUpload(doc.type, e.target.files[0])}
                    />
                    <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-muted pointer-events-none">
                      <Upload className="w-3.5 h-3.5 mr-1" />
                      {doc.status === 'pending' ? 'Upload' : 'Replace'}
                    </Button>
                  </label>
                </div>
              </div>
            ))}

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
              <p className="text-xs text-amber-300">
                <strong>Accepted formats:</strong> PDF, JPG, PNG. Max file size: 10MB per document.
                Documents must be clear, unobstructed, and not expired. Our AI engine (PaddleOCR + Docling) will automatically extract and verify the information.
              </p>
            </div>
          </div>
        )}

        {/* ── Step 5: Review & Submit ── */}
        {step === 5 && (
          <div className="space-y-4">
            {status === 'draft' ? (
              <>
                <h2 className="text-xl font-semibold text-foreground">Review & Submit</h2>
                <p className="text-muted-foreground text-sm">Please review your application before submitting.</p>

                <Card className="bg-card border-border">
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Entity Type</span>
                      <span className="text-foreground">{ENTITY_TYPES.find(e => e.value === entityType)?.label}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Legal Name</span>
                      <span className="text-foreground">{watch('legalName')}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Contact</span>
                      <span className="text-foreground">{watch('contactName')} ({watch('contactEmail')})</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Stakeholders</span>
                      <span className="text-foreground">{stakeholders.length} person(s) added</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Documents</span>
                      <span className="text-foreground">{documents.filter(d => d.status === 'uploaded').length}/{documents.filter(d => d.required).length} required uploaded</span>
                    </div>
                  </CardContent>
                </Card>

                {/* PEP Declaration */}
                <div className="flex items-start gap-3 p-4 bg-card border border-border rounded-xl">
                  <Checkbox
                    id="pep"
                    onCheckedChange={v => setValue('pepDeclaration', v as boolean)}
                    className="mt-0.5"
                  />
                  <label htmlFor="pep" className="text-sm text-muted-foreground cursor-pointer">
                    <strong>PEP Declaration:</strong> I confirm that neither I, nor any director or beneficial owner of this entity, is a Politically Exposed Person (PEP) or is subject to any sanctions.
                  </label>
                </div>

                {/* Terms */}
                <div className="flex items-start gap-3 p-4 bg-card border border-border rounded-xl">
                  <Checkbox
                    id="terms"
                    onCheckedChange={v => setValue('agreedToTerms', v as boolean)}
                    className="mt-0.5"
                  />
                  <label htmlFor="terms" className="text-sm text-muted-foreground cursor-pointer">
                    I agree to the <a href="/terms" className="text-emerald-400 underline">Terms of Service</a>, <a href="/privacy" className="text-emerald-400 underline">Privacy Policy</a>, and <a href="/aml-policy" className="text-emerald-400 underline">AML/CFT Policy</a>. I confirm that all information provided is accurate and complete.
                  </label>
                </div>

                <Button
                  onClick={handleSubmit(handleSubmitApplication)}
                  disabled={submitting}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-foreground"
                  size="lg"
                >
                  {submitting ? (
                    <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Submitting...</>
                  ) : (
                    <><Send className="w-4 h-4 mr-2" /> Submit Application</>
                  )}
                </Button>
              </>
            ) : (
              /* Post-submission status view */
              <div className="space-y-4">
                <div className={`flex items-center gap-3 p-5 rounded-xl border ${STATUS_CONFIG[status].color.replace('text-', 'border-').replace('/20', '/30')} bg-opacity-10`}>
                  {STATUS_CONFIG[status].icon}
                  <div>
                    <div className="font-semibold text-foreground">{STATUS_CONFIG[status].label}</div>
                    <div className="text-sm text-muted-foreground">{STATUS_CONFIG[status].description}</div>
                  </div>
                </div>

                {referenceId && (
                  <div className="flex items-center justify-between p-4 bg-card border border-border rounded-xl">
                    <span className="text-muted-foreground text-sm">Reference ID</span>
                    <span className="font-mono text-emerald-400 font-semibold">{referenceId}</span>
                  </div>
                )}

                <div className="bg-primary/10 border border-primary/20 rounded-xl p-4">
                  <p className="text-sm text-blue-300 font-medium mb-2">What happens next?</p>
                  <ul className="space-y-1.5">
                    {[
                      '1. Upload all required documents (if not already done)',
                      '2. Directors/shareholders will receive KYC invitation links',
                      '3. Our AI engine will verify all documents automatically',
                      '4. A compliance officer will review your application (1-3 business days)',
                      '5. You will receive an email/SMS with the final decision',
                    ].map((step, i) => (
                      <li key={i} className="text-xs text-blue-400/80 flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        {step}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Navigation Buttons */}
        {step > 0 && step < 5 && (
          <div className="flex justify-between mt-6">
            <Button variant="outline" onClick={handleBack} className="border-border text-muted-foreground">
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <Button onClick={handleNext} className="bg-emerald-600 hover:bg-emerald-500 text-foreground">
              Continue <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

      </div>
    </div>
  );
}


export default function StakeholderOnboardingWizard() {
  return (
    <BISLayout>
      <StakeholderOnboardingWizardInner />
    </BISLayout>
  );
}
