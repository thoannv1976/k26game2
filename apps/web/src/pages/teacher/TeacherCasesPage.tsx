import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/ui';
import { CaseBank } from '../cases/CaseBank';

export default function TeacherCasesPage() {
  const { t } = useTranslation();
  const { role } = useAuth();
  return (
    <div>
      <PageHeader title={t('caseBank.title')} subtitle={t('caseBank.subtitle')} />
      <CaseBank canAdmin={role === 'school_admin'} />
    </div>
  );
}
