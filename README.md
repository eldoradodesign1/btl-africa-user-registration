# BTL Africa — Création d’utilisateurs

Interface React/Vite mobile-first pour enregistrer un nouvel utilisateur ou agent dans la table existante `public.users` de BTL Africa Privilege Tracker.

## Ce qui est inclus

L’interface propose une validation MSISDN en temps réel, un contrôle anti-doublon à trois niveaux, une liste de superviseurs filtrée par rôle, les catégories de campagne distinctes, la règle « Aucun shop » vers `null`, un état de chargement non bloquant, les toasts de succès/erreur, un récapitulatif non sensible après création, un tableau de bord administrateur sécurisé et un mode démo explicite lorsque Supabase n’est pas configuré.

Le code est organisé dans le template WebDev React :

| Cahier des charges | Fichier du projet |
| --- | --- |
| `index.html` | `client/index.html` |
| `styles.css` | `client/src/index.css` — thème global de l’interface |
| `app.js` | `client/src/App.tsx` + `client/src/pages/Home.tsx` |
| Module téléphone | `client/src/lib/phone.ts` |
| Module Supabase | `client/src/lib/supabase.ts` |
| Dashboard | `client/src/pages/AdminDashboard.tsx` |
| Règles du formulaire | `client/src/lib/user-form.ts` |
| Tests | `client/src/lib/phone.test.ts` et `client/src/lib/supabase.test.ts` |

## Branchement Supabase

Pour une configuration au démarrage, créez un fichier `.env.local` à la racine du projet et renseignez :

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key>
```

`VITE_SUPABASE_ANON_KEY` est également accepté pour les projets qui utilisent encore l’ancien nom de variable. Redémarrez ensuite le serveur Vite.

Vous pouvez aussi renseigner les valeurs directement dans **Dashboard → Configurer**. Cette configuration runtime est conservée localement pour restaurer la connexion après rechargement ; elle est effacée quand le projet est déconnecté. La clé Supabase est toujours saisie dans un champ masqué et les clés contenant `service_role` sont refusées.

Après configuration, le dashboard demande une connexion **par MSISDN et mot de passe existant** avant de lire `public.users`. Le numéro local `0812345678` est essayé avec son équivalent international `+243812345678`, puis la ligne est vérifiée avec la valeur déjà utilisée dans `password_hash`. Aucun nouveau mécanisme d’authentification n’est introduit. Le profil correspondant détermine le rôle. L’écran n’affiche pas les données fictives dans ce parcours réel.

Les rôles `admin`, `super_admin`, `supervisor` et `sub_admin` sont autorisés à ouvrir le formulaire de création. Les rôles `supervisor` et `sub_admin` y sont limités à la création d’agents; les admins peuvent conserver la création des autres rôles. Les demandes d’inscription restent exclusivement validables par un `super_admin`. Les rôles `agent`, `supervisor` et `sub_admin` peuvent se connecter au dashboard, rechercher, filtrer, actualiser et exporter les données; les opérations d’écriture restent contrôlées par leurs RPC métier respectives. Les politiques RLS du projet doivent autoriser l’utilisateur authentifié à sélectionner les colonnes nécessaires et doivent réserver l’insertion à la logique d’administration autorisée.

## Création de compte et approbation

L’écran de connexion propose désormais deux options : **Se connecter** et **Créer un compte**. Le signup crée exclusivement une demande d’accès de rôle `agent` dans `public.user_registration_requests`; il ne crée jamais directement une ligne dans `public.users`. La demande reste `pending` jusqu’à l’action d’un `super_admin`, puis l’approbation crée l’agent dans `public.users`. Les agents pending ne sont donc pas renvoyés par la liste principale et ne peuvent pas apparaître dans les listes opérationnelles avant validation.

La migration à exécuter dans le projet Supabase est [`supabase/migrations/202609210001_registration_requests.sql`](supabase/migrations/202609210001_registration_requests.sql). Elle crée la table, son index anti-doublon sur les demandes pending et quatre fonctions RPC `SECURITY DEFINER` : création de demande publique, lecture super_admin, approbation et rejet. Le projet utilise une authentification métier basée sur `public.users.password_hash` et non Supabase Auth; les RPC reviewer valident donc explicitement l’UUID et le rôle `super_admin` avant toute lecture ou mutation.

Pour activer les champs complémentaires du compte, exécutez ensuite [`supabase/migrations/202609210011_registration_profile_details.sql`](supabase/migrations/202609210011_registration_profile_details.sql). Cette migration ajoute le numéro M-Pesa (`phone`), le numéro WhatsApp et son indicateur « même numéro », la date de naissance, l’adresse et la photo de profil aux demandes et aux utilisateurs. Elle remplace les RPC de signup, d’approbation et de création superadmin avec leurs signatures étendues.

Les campagnes existantes sont lues depuis `public.campaigns` et les affectations actives depuis `public.user_campaign_assignments`. La migration [`supabase/migrations/202609210002_campaign_assignments_rpc.sql`](supabase/migrations/202609210002_campaign_assignments_rpc.sql) ajoute la RPC `set_user_campaign_assignments`, réservée aux rôles `admin`, `super_admin` et `supervisor`. Elle permet plusieurs campagnes par agent, désactive les anciennes affectations retirées et vérifie la compatibilité entre une campagne hôtesse ou Brand Ambassador et la catégorie de l’agent.

Les vues par rôle utilisent les données métier existantes : `daily_reports` pour les hôtesses et `ba_daily_attendance` via `campaign_runs` pour les Brand Ambassadors. La migration [`supabase/migrations/202609210003_campaign_assignment_requests.sql`](supabase/migrations/202609210003_campaign_assignment_requests.sql) crée les demandes d’affectation des agents ainsi que les RPC de consultation et de validation par les managers. La migration [`supabase/migrations/202609210004_user_profile_updates.sql`](supabase/migrations/202609210004_user_profile_updates.sql) conserve le stockage direct des mots de passe et exige uniquement le mot de passe actuel avant une modification de profil.

La migration [`supabase/migrations/202609230001_campaign_supervisor_assignments.sql`](supabase/migrations/202609230001_campaign_supervisor_assignments.sql) ajoute la relation opérationnelle `agent_campaign_supervisor_assignments`. La colonne partagée `users.supervisor_id` n’est pas modifiée et aucune table Lime n’est créée : dans cette application, sa valeur représente désormais le **Lime** de l’utilisateur, à la place du superviseur qui l’avait fait entrer dans l’agence. La relation opérationnelle par campagne permet toujours plusieurs superviseurs pour un même agent et une même campagne. Elle synchronise encore `user_campaign_assignments` pour préserver les rapports existants, filtre les demandes d’affectation vers le superviseur opérationnel concerné et prépare le compte administratif temporaire `Sam` demandé pour le reclassement initial. Les superviseurs utilisent le dashboard global et voient tous les agents; les RPC continuent de contrôler les affectations et le traitement des demandes.

Les migrations [`supabase/migrations/202609230004_lime_hierarchy.sql`](supabase/migrations/202609230004_lime_hierarchy.sql) puis [`supabase/migrations/202609230005_lime_test_exceptions.sql`](supabase/migrations/202609230005_lime_test_exceptions.sql) appliquent la hiérarchie Lime réelle demandée. Sam est le Lime de Bradley et Michael; Bradley celui d’Eldo, Arnold, Daniel et Benedicte; Arnold celui d’Hervé, Serge, Alpha et Shekinah; Eldo celui de Ruth Mafuta et des comptes de test; Hervé celui des hôtesses et des BA MIKILI; Alpha celui des autres BA. Aucun compte correspondant à Abel ou Supervisor n’étant présent dans la base au moment de l’application, ces deux rattachements restent à compléter lorsqu’ils seront identifiés.

Dans l’espace agent, les campagnes sont maintenant choisies dans un sélecteur unique placé au-dessus du suivi. Par défaut, il sélectionne la campagne active affectée la plus récente, selon sa date de début, afin de réduire les clics. La courbe et le calendrier ne sont chargés que pour une campagne affectée ; une campagne non affectée affiche uniquement la possibilité de demander l’affectation. Les périodes de pause sont grisées et ne sont pas comptées comme des absences. Pour activer les réclamations, exécutez ensuite [`supabase/migrations/202609220012_campaign_claims.sql`](supabase/migrations/202609220012_campaign_claims.sql), puis [`supabase/migrations/202609230002_campaign_claims_supervision.sql`](supabase/migrations/202609230002_campaign_claims_supervision.sql), puis [`supabase/migrations/202609230003_campaign_claim_cases.sql`](supabase/migrations/202609230003_campaign_claim_cases.sql). La première migration crée `campaign_claims`, la seconde rend les RPC compatibles avec les affectations opérationnelles par campagne et la troisième transforme les réclamations en dossiers suivis avec priorité, catégorie, statuts, messages partagés, notes internes, demandes d’informations et journal d’événements.

Le workflow d’un dossier est le suivant : **Nouveau → En cours d’analyse → Informations attendues → En cours d’analyse → Résolu ou Rejeté**. Un agent peut consulter son dossier, recevoir les réponses de l’équipe et répondre lorsqu’une information est demandée. Un superviseur, la coordination, un administrateur ou un superadmin peut ouvrir le dossier, ajouter une réponse partagée, ajouter une note interne, demander des informations, le résoudre ou le rejeter. Les messages non lus de l’agent sont signalés dans son espace et chaque dossier conserve son historique.

Les superadmins disposent également d’une barre **Simulation superadmin** persistante. Le sélecteur custom présente tous les utilisateurs par ordre alphabétique et les raccourcis `AG`, `SUP` et `ADM` ciblent respectivement `Agent Test`, `Hervé Ntalu` et `Bradley`. La simulation remplace uniquement le profil affiché : la session réelle reste celle du superadmin, la barre reste visible et le bouton **Quitter** restaure le compte réel. Les vues simulées sont consultatives afin d’éviter toute écriture accidentelle dans la base.

Les rôles `supervisor` et `sub_admin` utilisent désormais le même dashboard de gestion que les rôles administratifs, au lieu d’un workspace superviseur séparé. Ils voient tous les agents de `public.users`; leurs affectations de campagne et leurs dossiers restent contrôlés par les RPC métier. Le bouton **Ajouter un agent** est disponible dans ce dashboard pour les rôles `supervisor` et `sub_admin`; le bouton **Nouvel utilisateur** reste disponible pour `admin` et `super_admin`. Aucun de ces rôles administratifs ne peut valider les demandes d’inscription, cette action restant réservée au superadmin.

Dans l’espace agent, tous les administratifs — superviseur, coordination, administrateur et Support IT — sont visibles avec leur nom et leur poste, sans numéro dans la liste. Les supérieurs hiérarchiques de l’agent, y compris les superviseurs opérationnels associés à ses campagnes, restent cliquables et ouvrent une fiche avec leur téléphone copiable, leur chaîne hiérarchique et les campagnes concernées. Une demande créée depuis cette fiche est enregistrée dans `campaign_assignment_requests` et devient visible par le superviseur opérationnel de la campagne ainsi que par les rôles administratifs globaux. La migration [`supabase/migrations/202609210007_supervisor_assignment_visibility.sql`](supabase/migrations/202609210007_supervisor_assignment_visibility.sql) reste compatible avec les bases déjà migrées ; la migration `202609230001` remplace ses filtres de demandes par la relation campagne-superviseur.

La création manuelle depuis le dashboard utilise la RPC `create_user_by_super_admin` au lieu d’un `INSERT` direct depuis le navigateur. Exécutez [`supabase/migrations/202609210008_superadmin_user_creation_rpc.sql`](supabase/migrations/202609210008_superadmin_user_creation_rpc.sql), puis [`supabase/migrations/202609230006_admin_user_creation.sql`](supabase/migrations/202609230006_admin_user_creation.sql) et enfin [`supabase/migrations/202609240003_staff_agent_creation.sql`](supabase/migrations/202609240003_staff_agent_creation.sql), avant d’utiliser cette fonctionnalité sur un projet existant. Cette dernière migration autorise `supervisor` et `sub_admin` à créer uniquement des agents. Le dashboard propose également une bascule **Vue liste / Vue cartes** ; les clics sur une carte et les boutons d’action conservent le même comportement que dans la table.

Les shops d’affectation sont chargés depuis `public.shops` (`id`, `name`, `city`, `type`). Les sélecteurs et les listes affichent le champ `name` — par exemple `S003` apparaît comme **JEFFERY TRAVELS SAIO** — tandis que la valeur `id` reste utilisée uniquement pour l’enregistrement dans `public.users.permanent_shop_id`. Les valeurs historiques non présentes dans `shops` sont signalées comme non référencées et les valeurs `NULL` apparaissent comme « — ».

Le statut **Actif/Inactif** est visible et cliquable selon la portée du rôle : le superadmin peut agir partout, l’admin peut agir sur tous les comptes sauf le superadmin, la coordination peut agir sur les superviseurs et les agents, et un superviseur peut agir sur les agents. Les autres statuts restent masqués dans leur liste. Exécutez [`supabase/migrations/202609230010_user_activity_status_rpc.sql`](supabase/migrations/202609230010_user_activity_status_rpc.sql), puis [`supabase/migrations/202609230011_user_activity_status_safe_return.sql`](supabase/migrations/202609230011_user_activity_status_safe_return.sql) ; la seconde remplace le retour de la RPC par un objet sans `password_hash`.

Le dashboard se synchronise avec les changements Realtime Supabase sur les tables métier principales. La publication `supabase_realtime` est gérée par la migration [`202609230008_enable_realtime_tables.sql`](supabase/migrations/202609230008_enable_realtime_tables.sql), de manière idempotente. Une resynchronisation complète est déclenchée au retour sur l’onglet, au retour du réseau ou lors d’une reconnexion de la fenêtre. Si le transport Realtime est momentanément indisponible, un repli court et limité à l’onglet visible maintient les données fraîches; les lectures HTTP utilisent également `no-store` afin que les changements de photo, rôle et statut ne restent pas servis depuis un cache.

Les migrations [`202609240004_refresh_postgrest_schema.sql`](supabase/migrations/202609240004_refresh_postgrest_schema.sql) et [`202609240005_staff_creation_null_guard.sql`](supabase/migrations/202609240005_staff_creation_null_guard.sql) réappliquent les droits d’exécution, rechargent le schéma PostgREST et refusent explicitement tout créateur inexistant. Elles ont été appliquées au projet partagé pour rendre les fonctions immédiatement accessibles à l’application sans ouvrir la création à une session anonyme.

Si le projet possède une contrainte `NOT NULL` sur `public.users.user_category`, exécutez ensuite [`supabase/migrations/202609210009_fix_user_category_for_admin_creation.sql`](supabase/migrations/202609210009_fix_user_category_for_admin_creation.sql). Les profils non agents recevront automatiquement la catégorie technique `operations`, tandis que les campagnes restent réservées aux catégories agent compatibles.

La connexion métier est persistée localement sans enregistrer le mot de passe : la configuration Supabase et le profil courant sont restaurés au rechargement, puis supprimés lors de la déconnexion. Le logo officiel Beyond The Line est servi en WebP léger, avec une icône PWA versionnée pour éviter le favicon obsolète. Les photos de profil sont stockées dans `public.users.avatar_url`, affichées dans le hero et les fiches, avec choix, aperçu et suppression depuis l’icône d’édition du profil.

Après connexion, un agent voit ses responsables, ses campagnes et un suivi combinant courbe de performance et registre de présence. Chaque date travaillée du calendrier est cliquable : elle ouvre le rapport journalier ou le registre de clôture, avec une alerte visuelle lorsque le commentaire n’a pas été envoyé. Les superviseurs utilisent le dashboard global : ils voient tous les agents, peuvent ouvrir une fiche, appeler un agent, sélectionner une campagne, approuver une demande et exporter le suivi au format XLSX ou PDF. Dans la console admin, le clic sur un agent ouvre cette même fiche; l’édition reste accessible dans la fiche et par l’action crayon.

**Ne renseignez jamais une clé `service_role` dans une variable `VITE_*` ou dans le frontend.** Si une opération d’administration exige des privilèges élevés, utilisez une RPC ou une Edge Function Supabase sécurisée, puis appelez-la depuis le frontend avec la clé publishable/anon et des politiques RLS adaptées.

Sans ces variables, l’application n’affiche aucune donnée utilisateur locale et demande une configuration Supabase réelle avant toute lecture ou écriture. Aucun utilisateur fictif n’est embarqué dans le code. Aucun mot de passe n’est stocké dans `localStorage` ou l’URL ; la connexion reste en mémoire jusqu’à la fermeture ou la déconnexion.

## Dashboard et historique MSISDN

Le dashboard permet de rechercher rapidement un nom ou un MSISDN — le format `+24381…` est normalisé avant la comparaison — puis de filtrer par rôle, catégorie, statut **Actif/Inactif** et campagne. Le champ `public.users.is_active` est ajouté par [`supabase/migrations/202609230009_user_activity_status.sql`](supabase/migrations/202609230009_user_activity_status.sql), avec la valeur `true` par défaut pour préserver les utilisateurs existants. La modale d’édition permet de changer ce statut, principalement utilisé pour les agents. Les graphiques sont placés au-dessus de la barre de filtres, qui reste juste au-dessus de la liste. La liste propose une vue table ou cartes, et le bouton **Nouvel utilisateur** est regroupé avec les contrôles de liste. L’export ouvre un aperçu proposant CSV, XLSX et PDF ; chaque ligne filtrée peut être désélectionnée avant export, et les raccourcis `C`, `X` et `P` déclenchent directement le format correspondant.

## Schéma cible et payload

La table principale reste `public.users`. Les parcours déjà intégrés utilisent également les tables métier existantes `campaigns`, `user_campaign_assignments`, `campaign_runs`, `campaign_pauses`, `daily_reports` et `ba_daily_attendance`, ainsi que les tables de demandes créées par les migrations indiquées plus haut. L’application ne crée pas de table métier implicite côté navigateur.

Exemple de payload strict, limité aux colonnes autorisées :

```json
{
  "id": "6a3ecb0e-f3b2-4fd8-9f12-bb9dc2b2fa8d",
  "full_name": "Grâce Mbuyi",
  "phone": "0812345678",
  "password_hash": "<valeur conforme au mécanisme d’authentification existant>",
  "role": "agent",
  "user_category": "hostess",
  "is_active": true,
  "supervisor_id": "b7d7aef4-2e2b-4a7e-9f12-1d5ce8481b0a",
  "permanent_shop_id": null
}
```

L’interface normalise toujours le téléphone au format local `0XXXXXXXXX` avant la recherche et l’insertion. « Aucun shop » est transformé en `null`, jamais enregistré comme une chaîne.

## Identifiants utilisateurs

Dans le projet Supabase cible, le champ `public.users.id` est de type **text**. Les demandes d’inscription utilisent un UUID interne, converti explicitement en texte uniquement au moment de l’approbation afin de rester compatible avec le schéma existant. Aucun identifiant réel n’est hardcodé dans l’application métier et le code ne suppose jamais que les identifiants sont séquentiels.

## Contrôle anti-doublon

1. **Validation locale** : nettoyage des espaces, tirets, points, parenthèses et `+`, validation du préfixe `08`/`09` et du nombre de chiffres.
2. **Lookup Supabase debounced** : recherche ciblée `.eq('phone', normalizedPhone)` après 420 ms, avec invalidation des requêtes obsolètes.
3. **Contrainte unique PostgreSQL** : une erreur `23505` ou une erreur mentionnant `phone` est convertie en message anti-doublon professionnel.

Les rôles proposés sont strictement `agent`, `supervisor`, `sub_admin`, `admin` et `super_admin`. Les catégories sont strictement `hostess`, `brand_ambassador`, `brand_ambassador_youth` et `operations`.

## Développement et tests

```bash
pnpm install
pnpm dev
pnpm check
pnpm exec vitest run client/src/lib/phone.test.ts client/src/lib/supabase.test.ts
pnpm build
```

Le bouton **Créer l’utilisateur** est désactivé tant que le nom, le MSISDN ou le contrôle anti-doublon n’est pas valide. L’accès au formulaire est en plus réservé au profil `super_admin`. Le formulaire reste utilisable au clavier et sur mobile.

Toutes les occurrences de téléphone rendues dans l’interface utilisent maintenant le bouton `CopyablePhone`; un clic copie le numéro brut dans le presse-papier, avec un fallback compatible lorsque l’API Clipboard n’est pas disponible. Les modales du dashboard sont rendues dans `document.body` via un portal, avec une hauteur indépendante du contenu de la page et un scroll interne uniquement lorsque nécessaire.
