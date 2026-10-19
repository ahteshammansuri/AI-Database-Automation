import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion, type Variants, AnimatePresence } from "framer-motion";
import {
  Database,
  ShieldCheck,
  Cpu,
  Mail,
  Clock,
  CheckCircle2,
  Lock,
  ArrowRight,
  LayoutDashboard,
  User as UserIcon,
  Layers,
  Code2,
  Check,
  Zap,
  Workflow,
  GitBranch,
  BookOpen,
  ShoppingBag,
  FileText,
  HelpCircle,
  Server,
  Network,
  Menu,
  X,
  ChevronRight,
  RefreshCw,
  Terminal,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

export const LandingPage: React.FC = () => {
  const { isAuthenticated, user } = useAuth();
  const [activeTab, setActiveTab] = useState<"SCHEMA" | "AI_GEN" | "APPROVAL" | "GRAPH">("AI_GEN");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<number>(0);

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.05,
      },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: "easeOut" } },
  };

  const services = [
    {
      id: "blog-cms",
      icon: FileText,
      badge: "Content Automation",
      title: "Relational Blog & Article Publishing Engine",
      summary: "End-to-end publishing pipelines with automated SEO slugification, category foreign-key resolution, and editorial email reviews.",
      highlight: "Saves ~90% of drafting time while maintaining 100% database integrity.",
      features: [
        "Dynamic category resolution: auto-creates parent categories or links existing IDs",
        "Unique slug generation with collision detection and auto-indexing",
        "Dual publication triggers: Instant publish or scheduled recurring cron",
        "Email previews with single-use cryptographic approval/rejection links",
      ],
      sampleTable: "blog_cms.posts",
      fields: ["title", "slug", "content", "category_id (FK)", "status", "published_at"],
    },
    {
      id: "catalog-enrichment",
      icon: ShoppingBag,
      badge: "Catalog Automation",
      title: "E-Commerce Product & Spec Enrichment",
      summary: "Introspects product tables, extracts structured specifications from raw supplier text or PDFs, and normalizes catalog attributes.",
      highlight: "Guaranteed zero-DDL: pricing, inventory, and order tables are protected by policy.",
      features: [
        "Structured attribute parsing (dimensions, materials, compatibility matrix)",
        "Automated SEO meta descriptions and search-index keywords",
        "Batch transactional insertion across product_details and attributes",
        "Strict foreign key enforcement: links directly to brand_id and category_id",
      ],
      sampleTable: "store.products",
      fields: ["sku", "title", "description", "brand_id (FK)", "meta_keywords", "specs_json"],
    },
    {
      id: "faq-synthesis",
      icon: HelpCircle,
      badge: "Support Automation",
      title: "Dynamic Knowledge Base & FAQ Auto-Synthesis",
      summary: "Extracts grounded domain knowledge from uploaded Markdown, TXT, or PDF documents via local FAISS vectors and publishes FAQs.",
      highlight: "100% grounded in your uploaded documents. No hallucinated business rules.",
      features: [
        "Local vector embeddings (Ollama nomic-embed-text) indexed in private FAISS",
        "Extracts real user questions and generates validated answers",
        "Atomic updates to support_faqs and help_articles tables",
        "Auditable source chunk references stored alongside every generated record",
      ],
      sampleTable: "support.faqs",
      fields: ["question", "answer", "category_id (FK)", "source_chunk_id", "is_active"],
    },
    {
      id: "graph-resolver",
      icon: GitBranch,
      badge: "Relational Integrity",
      title: "Foreign Key Graph Resolver & Atomic Transactions",
      summary: "Understands relational dependencies. Atomically creates missing parent records, captures auto-increment IDs, and links child tables.",
      highlight: "ACID rollback guarantee: if child insertion fails, parent state rolls back safely.",
      features: [
        "Automated dependency topological sort based on information_schema.KEY_COLUMN_USAGE",
        "Parent-first insertion with LAST_INSERT_ID() binding",
        "Supports composite keys, unique indexes, and nullable foreign relations",
        "Zero orphan records: multi-table writes execute inside transactional boundaries",
      ],
      sampleTable: "relational_graph",
      fields: ["parent_taxonomies", "intermediate_tags", "target_content_records"],
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col selection:bg-indigo-600 selection:text-white overflow-x-hidden">
      {/* Fixed Sticky Glassmorphism Header */}
      <header className="glass-nav sticky top-0 z-50 transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-3 group">
            <motion.div
              whileHover={{ rotate: 8, scale: 1.05 }}
              transition={{ type: "spring", stiffness: 300, damping: 15 }}
              className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center shadow-xs"
            >
              <Database className="w-5 h-5 text-white" />
            </motion.div>
            <div>
              <span className="text-base sm:text-lg font-bold text-slate-900 tracking-tight flex items-center gap-1.5">
                DataAuto
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/80 font-bold uppercase tracking-wider">
                  ENTERPRISE
                </span>
              </span>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center space-x-7 text-xs font-semibold text-slate-600">
            <a href="#services" className="hover:text-indigo-600 transition-colors">
              Services & Solutions
            </a>
            <a href="#pipeline" className="hover:text-indigo-600 transition-colors">
              Pipeline Engine
            </a>
            <a href="#security" className="hover:text-indigo-600 transition-colors">
              Security Guardrails
            </a>
            <a href="#architecture" className="hover:text-indigo-600 transition-colors">
              Architecture
            </a>
            <a href="#how-it-works" className="hover:text-indigo-600 transition-colors">
              How It Works
            </a>
          </nav>

          {/* User Actions */}
          <div className="hidden sm:flex items-center space-x-3">
            {isAuthenticated ? (
              <div className="flex items-center space-x-3">
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg font-medium border border-slate-200">
                  <UserIcon className="w-3.5 h-3.5 text-indigo-600" />
                  <span>{user?.name || user?.email}</span>
                </span>
                <Link
                  to="/dashboard"
                  className="btn-primary-gradient text-xs font-semibold text-white px-4 py-2 rounded-lg shadow-xs transition flex items-center space-x-1.5"
                >
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  <span>Dashboard</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors px-3 py-2"
                >
                  Sign In
                </Link>
                <Link
                  to="/register"
                  className="btn-primary-gradient text-xs font-semibold text-white px-4 py-2 rounded-lg shadow-xs transition flex items-center space-x-1.5"
                >
                  <span>Get Started Free</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </>
            )}
          </div>

          {/* Mobile Hamburger Toggle */}
          <div className="flex md:hidden items-center">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Navigation */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden border-b border-slate-200 bg-white/95 backdrop-blur-md px-6 py-4 space-y-3"
            >
              <div className="flex flex-col space-y-2.5 text-xs font-semibold text-slate-700">
                <a
                  href="#services"
                  onClick={() => setMobileMenuOpen(false)}
                  className="py-1 hover:text-indigo-600"
                >
                  Services & Solutions
                </a>
                <a
                  href="#pipeline"
                  onClick={() => setMobileMenuOpen(false)}
                  className="py-1 hover:text-indigo-600"
                >
                  Pipeline Engine
                </a>
                <a
                  href="#security"
                  onClick={() => setMobileMenuOpen(false)}
                  className="py-1 hover:text-indigo-600"
                >
                  Security Guardrails
                </a>
                <a
                  href="#architecture"
                  onClick={() => setMobileMenuOpen(false)}
                  className="py-1 hover:text-indigo-600"
                >
                  Architecture
                </a>
                <a
                  href="#how-it-works"
                  onClick={() => setMobileMenuOpen(false)}
                  className="py-1 hover:text-indigo-600"
                >
                  How It Works
                </a>
              </div>

              <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
                {isAuthenticated ? (
                  <Link
                    to="/dashboard"
                    onClick={() => setMobileMenuOpen(false)}
                    className="btn-primary-gradient text-xs font-semibold text-white px-4 py-2.5 rounded-lg text-center flex items-center justify-center gap-2"
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    <span>Open Dashboard</span>
                  </Link>
                ) : (
                  <>
                    <Link
                      to="/login"
                      onClick={() => setMobileMenuOpen(false)}
                      className="px-4 py-2 rounded-lg text-xs font-semibold text-center border border-slate-200 text-slate-700"
                    >
                      Sign In
                    </Link>
                    <Link
                      to="/register"
                      onClick={() => setMobileMenuOpen(false)}
                      className="btn-primary-gradient px-4 py-2 rounded-lg text-xs font-semibold text-white text-center"
                    >
                      Create Free Workspace
                    </Link>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-14 pb-20 md:pt-20 md:pb-28 px-4 sm:px-6 mesh-gradient-hero">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="max-w-4xl mx-auto text-center relative z-10"
        >
          {/* Live Status Badge */}
          <motion.div variants={itemVariants} className="inline-block">
            <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-white/95 border border-indigo-200 shadow-2xs text-xs text-indigo-700 font-semibold mb-6">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span>Self-Service Multi-Tenant Relational Database Automation</span>
            </div>
          </motion.div>

          {/* Main Title */}
          <motion.h1
            variants={itemVariants}
            className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 mb-6 leading-tight"
          >
            Automate Content & Data Directly Into Your{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600">
              MySQL Database
            </span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            variants={itemVariants}
            className="text-sm sm:text-base lg:text-lg text-slate-600 max-w-2xl mx-auto mb-8 leading-relaxed font-normal"
          >
            Connect any target MySQL database, discover schema constraints, inject tenant business knowledge (RAG), and execute scheduled publishing pipelines with human-in-the-loop email approvals.
          </motion.p>

          {/* Action CTAs */}
          <motion.div
            variants={itemVariants}
            className="flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            {isAuthenticated ? (
              <>
                <Link
                  to="/dashboard"
                  className="w-full sm:w-auto px-7 py-3 rounded-xl btn-primary-gradient text-white font-semibold shadow-md transition flex items-center justify-center space-x-2 text-xs sm:text-sm"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span>Go to Your Dashboard</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/explorer"
                  className="w-full sm:w-auto px-7 py-3 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-semibold transition flex items-center justify-center text-xs sm:text-sm shadow-2xs hover:border-slate-400"
                >
                  Explore Target Schemas
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/register"
                  className="w-full sm:w-auto px-7 py-3 rounded-xl btn-primary-gradient text-white font-semibold shadow-md transition flex items-center justify-center space-x-2 text-xs sm:text-sm"
                >
                  <span>Start Free Workspace</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/login"
                  className="w-full sm:w-auto px-7 py-3 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-semibold transition flex items-center justify-center text-xs sm:text-sm shadow-2xs hover:border-slate-400"
                >
                  Sign In to Portal
                </Link>
              </>
            )}
          </motion.div>

          {/* Core Architectural Pillars */}
          <motion.div
            variants={itemVariants}
            className="mt-12 pt-8 border-t border-slate-200/80 grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 text-left"
          >
            <div className="flex items-start space-x-3 p-2.5 rounded-xl bg-white/70 border border-slate-100 shadow-2xs">
              <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
                <Cpu className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">Local Ollama First</p>
                <p className="text-[11px] text-slate-500">Zero paid API keys required</p>
              </div>
            </div>

            <div className="flex items-start space-x-3 p-2.5 rounded-xl bg-white/70 border border-slate-100 shadow-2xs">
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 shrink-0">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">Hard SQL Guardrails</p>
                <p className="text-[11px] text-slate-500">Never DELETE, DROP, or DDL</p>
              </div>
            </div>

            <div className="flex items-start space-x-3 p-2.5 rounded-xl bg-white/70 border border-slate-100 shadow-2xs">
              <div className="p-2 rounded-lg bg-amber-50 text-amber-600 shrink-0">
                <Mail className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">Email Approvals</p>
                <p className="text-[11px] text-slate-500">Expiring signed action tokens</p>
              </div>
            </div>

            <div className="flex items-start space-x-3 p-2.5 rounded-xl bg-white/70 border border-slate-100 shadow-2xs">
              <div className="p-2 rounded-lg bg-sky-50 text-sky-600 shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">Durable Schedules</p>
                <p className="text-[11px] text-slate-500">Fair multi-worker queues</p>
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* Live Interactive Pipeline Preview Card */}
        <motion.div
          id="pipeline"
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="max-w-4xl mx-auto mt-12 bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden scroll-mt-24"
        >
          {/* Card Top Bar */}
          <div className="bg-slate-900 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
              <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
              <span className="text-slate-400 font-mono text-xs ml-2">
                demo_blog_cms.posts → Real-Time Publishing Pipeline
              </span>
            </div>

            {/* Switcher Tabs */}
            <div className="flex items-center space-x-1 bg-slate-800 p-1 rounded-lg text-[11px] font-semibold">
              <button
                onClick={() => setActiveTab("SCHEMA")}
                className={`px-2.5 py-1 rounded transition ${
                  activeTab === "SCHEMA"
                    ? "bg-indigo-600 text-white font-bold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                1. Schema Scan
              </button>
              <button
                onClick={() => setActiveTab("AI_GEN")}
                className={`px-2.5 py-1 rounded transition ${
                  activeTab === "AI_GEN"
                    ? "bg-indigo-600 text-white font-bold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                2. Structured JSON
              </button>
              <button
                onClick={() => setActiveTab("APPROVAL")}
                className={`px-2.5 py-1 rounded transition ${
                  activeTab === "APPROVAL"
                    ? "bg-indigo-600 text-white font-bold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                3. Signed Approval
              </button>
              <button
                onClick={() => setActiveTab("GRAPH")}
                className={`px-2.5 py-1 rounded transition ${
                  activeTab === "GRAPH"
                    ? "bg-indigo-600 text-white font-bold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                4. FK Graph Resolver
              </button>
            </div>
          </div>

          {/* Interactive Card Content */}
          <div className="p-5 font-mono text-xs bg-slate-950 text-slate-200 min-h-[220px]">
            {activeTab === "SCHEMA" && (
              <div className="space-y-2 text-slate-300">
                <p className="text-emerald-400">// Read-only Introspected Schema via PDO information_schema query:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] bg-slate-900 p-3 rounded-lg border border-slate-800">
                  <div><strong>`title`:</strong> varchar(255) NOT NULL</div>
                  <div><strong>`slug`:</strong> varchar(255) UNIQUE NOT NULL</div>
                  <div><strong>`banner`:</strong> varchar(500) Stock URL / Media ID</div>
                  <div><strong>`status`:</strong> enum('draft','published')</div>
                  <div><strong>`category_id`:</strong> int(11) → FK blog_categories.id</div>
                  <div><strong>`deleted_at`:</strong> datetime NULL (Protected Field)</div>
                </div>
                <div className="flex items-center gap-2 pt-1 text-slate-400 text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>Validation Result: <strong className="text-emerald-400">ALLOWLISTED FOR AUTOMATED WRITE</strong></span>
                </div>
              </div>
            )}

            {activeTab === "AI_GEN" && (
              <div className="space-y-1.5 text-slate-300">
                <p className="text-indigo-400">// Strict Pydantic JSON Payload Generated via Local Ollama Inference:</p>
                <pre className="bg-slate-900 p-3 rounded-lg border border-slate-800 text-[11px] text-emerald-300 overflow-x-auto">
{`{
  "title": "Scaling Relational MySQL with Fair Queues and Ephemeral Pooling",
  "slug": "scaling-relational-mysql-fair-queues-ephemeral-pooling-2026",
  "banner": "https://api.your-site.com/storage/media/42/9f2c1e.jpg",
  "status": "published",
  "category_id": "Database Engineering",  // matched or created first, then its id is stored
  "content": "### High-Throughput Relational Workloads\\n\\nBy managing database connection lifecycles within ephemeral try-finally scopes, multi-tenant automation engines avoid resource pooling exhaustion while ensuring absolute tenant isolation..."
}`}
                </pre>
              </div>
            )}

            {activeTab === "APPROVAL" && (
              <div className="space-y-3 text-slate-300">
                <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="font-semibold text-slate-200">Single-Use Signed Token Verified</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold">
                    DECISION: APPROVED
                  </span>
                </div>

                <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-[11px] text-slate-300 space-y-1">
                  <div className="text-indigo-400 font-bold">SAFE PARAMETERIZED TARGET WRITE:</div>
                  <div className="text-slate-400 font-mono text-[10px] bg-slate-950 p-2 rounded">
                    INSERT INTO `posts` (`title`, `slug`, `banner`, `status`, `category_id`, `content`) VALUES (?, ?, ?, ?, ?, ?)
                  </div>
                  <div className="text-emerald-400 font-semibold pt-1">
                    ✓ Atomic Transaction Committed • Record ID #42 • Zero Destructive DDL
                  </div>
                </div>
              </div>
            )}

            {activeTab === "GRAPH" && (
              <div className="space-y-2 text-slate-300">
                <p className="text-violet-400">// Foreign Key Dependency Graph Resolution (ACID Transaction):</p>
                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 text-[11px] space-y-1.5">
                  <div className="text-slate-400">
                    Step 1: Inspect `category_id` FK reference → target table `blog_categories`.
                  </div>
                  <div className="text-slate-400">
                    Step 2: Lookup category "Database Engineering" → Not found, creating atomically:
                  </div>
                  <div className="text-emerald-400 font-mono pl-4">
                    INSERT INTO `blog_categories` (`name`, `slug`) VALUES ('Database Engineering', 'database-engineering') → Generated ID: 8
                  </div>
                  <div className="text-slate-400">
                    Step 3: Bind `category_id = 8` to child post record and insert into `posts`.
                  </div>
                  <div className="text-emerald-400 font-bold pt-1">
                    ✓ Complete Relational Graph Linked • 0 Orphan Records
                  </div>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </section>

      {/* Services Showcase Section */}
      <section id="services" className="py-20 bg-white border-y border-slate-200/80 px-4 sm:px-6 scroll-mt-20">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100">
              Enterprise Solutions
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mt-3 tracking-tight">
              Automation Services Built for Relational Databases
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-2 max-w-2xl mx-auto">
              Production-grade pipelines engineered specifically for customer MySQL tables. Each pipeline enforces relational integrity, field validation, and human review.
            </p>
          </div>

          {/* Interactive Service Showcase Grid */}
          <div className="grid lg:grid-cols-12 gap-8 items-start">
            {/* Service Selection Tabs (Left) */}
            <div className="lg:col-span-5 space-y-3">
              {services.map((svc, idx) => {
                const IconComp = svc.icon;
                const isSelected = selectedService === idx;
                return (
                  <motion.div
                    key={svc.id}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => setSelectedService(idx)}
                    className={`cursor-pointer p-4 rounded-xl border transition-all text-left flex items-start gap-3.5 ${
                      isSelected
                        ? "bg-indigo-50/70 border-indigo-300 shadow-xs"
                        : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"
                    }`}
                  >
                    <div
                      className={`p-2.5 rounded-lg shrink-0 ${
                        isSelected
                          ? "bg-indigo-600 text-white shadow-xs"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      <IconComp className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                          {svc.badge}
                        </span>
                        {isSelected && <ChevronRight className="w-4 h-4 text-indigo-600" />}
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 leading-snug truncate">
                        {svc.title}
                      </h3>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                        {svc.summary}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Detailed Active Service Panel (Right) */}
            <div className="lg:col-span-7 bg-slate-50 border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm flex flex-col justify-between min-h-[460px]">
              {(() => {
                const svc = services[selectedService];
                const IconComp = svc.icon;
                return (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                      <div className="flex items-center gap-3">
                        <div className="p-3 bg-indigo-600 text-white rounded-xl shadow-xs">
                          <IconComp className="w-6 h-6" />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
                            {svc.badge}
                          </span>
                          <h3 className="text-lg font-bold text-slate-900">{svc.title}</h3>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-mono bg-white border border-slate-200 text-slate-600 shadow-2xs">
                        Target: {svc.sampleTable}
                      </span>
                    </div>

                    <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-normal">
                      {svc.summary}
                    </p>

                    <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span className="text-xs font-semibold text-emerald-900">
                        {svc.highlight}
                      </span>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">
                        Key Capabilities & Safety Controls
                      </h4>
                      <ul className="space-y-2">
                        {svc.features.map((feat, fidx) => (
                          <li key={fidx} className="flex items-start gap-2.5 text-xs text-slate-600">
                            <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold">
                              ✓
                            </span>
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-[11px] text-slate-500 font-mono">
                        Mapped Columns: {svc.fields.slice(0, 3).join(", ")}...
                      </div>
                      <Link
                        to="/automations/new"
                        className="btn-primary-gradient px-4 py-2 text-white text-xs font-semibold rounded-lg shadow-xs inline-flex items-center gap-1.5 transition"
                      >
                        <Workflow className="w-3.5 h-3.5" />
                        <span>Build This Automation</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </section>

      {/* Non-Negotiable Security Boundaries */}
      <section id="security" className="py-20 px-4 sm:px-6 scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200">
              Security Guarantee
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mt-3 tracking-tight">
              Engineered with Hard SQL & Tenancy Guardrails
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-2 max-w-xl mx-auto">
              Zero AI-generated raw SQL execution. Strict tenant data segregation. Read-only introspection by default.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs card-hover-lift">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center mb-3">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Zero Destructive DDL</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                The platform will never execute DELETE, DROP, TRUNCATE, ALTER, or schema changes under any circumstances.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs card-hover-lift">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center justify-center mb-3">
                <Code2 className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Parameterized Writes Only</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                All database target executions use strict PDO parameterized INSERTs and scoped primary-key UPDATEs.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs card-hover-lift">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center mb-3">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Sensitive Table Exclusion</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Authentication, password, session, token, payment, and audit log tables are permanently restricted by policy.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs card-hover-lift">
              <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-700 border border-violet-200 flex items-center justify-center mb-3">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Multi-Tenant Isolation</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Every connection profile, document vector index, execution, and credential is bound to its authenticated user workspace.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs card-hover-lift">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 flex items-center justify-center mb-3">
                <Network className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">SSRF & Network Safety</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Database hosts are validated against private metadata destinations (AWS/GCP) to prevent malicious network traversal.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs card-hover-lift">
              <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-700 border border-sky-200 flex items-center justify-center mb-3">
                <Mail className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Signed Expiring Approvals</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Review draft content via email. Approval tokens are cryptographically signed, single-use, and expire automatically.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* System Architecture Flow */}
      <section id="architecture" className="py-20 bg-slate-900 text-white px-4 sm:px-6 scroll-mt-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest px-3 py-1 rounded-full bg-indigo-950 border border-indigo-800">
              Clean Separation of Concerns
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold mt-3 tracking-tight">
              Dual-Service Architecture
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-2 max-w-2xl mx-auto">
              Business authorization and database operations are strictly isolated from the AI inference layer.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 items-stretch">
            {/* Laravel Control Plane */}
            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2.5 text-indigo-400 font-bold text-sm">
                <Server className="w-5 h-5" />
                <span>1. Laravel Control Plane</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Manages multi-tenant authentication, field-level secret encryption, fair queue dispatching, schedule cron execution, signed email approval handling, and safe target database PDO writes.
              </p>
              <div className="p-3 bg-slate-900/80 rounded-xl text-[11px] font-mono text-indigo-300 space-y-1 border border-slate-800">
                <div>• User Authentication & Workspace Scoping</div>
                <div>• AES-256 Credential Encryption</div>
                <div>• Fair Background Job Scheduling</div>
                <div>• Prepared Statement Execution</div>
              </div>
            </div>

            {/* Python AI Service */}
            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2.5 text-violet-400 font-bold text-sm">
                <Cpu className="w-5 h-5" />
                <span>2. Python AI & RAG Engine</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Dedicated FastAPI microservice providing local Ollama integration, local embeddings (nomic-embed-text), FAISS vector indexing, and structured Pydantic JSON generation.
              </p>
              <div className="p-3 bg-slate-900/80 rounded-xl text-[11px] font-mono text-violet-300 space-y-1 border border-slate-800">
                <div>• Local Ollama / Hybrid Cloud Adapters</div>
                <div>• PDF / Markdown Document Chunking</div>
                <div>• FAISS Cosine Similarity Search</div>
                <div>• Strict Schema JSON Normalization</div>
              </div>
            </div>

            {/* Customer Target Database */}
            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2.5 text-emerald-400 font-bold text-sm">
                <Database className="w-5 h-5" />
                <span>3. Customer Target Database</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Your existing MySQL production or staging database. The AI service NEVER connects directly. Only validated, allowlisted operations are dispatched through ephemeral connections.
              </p>
              <div className="p-3 bg-slate-900/80 rounded-xl text-[11px] font-mono text-emerald-300 space-y-1 border border-slate-800">
                <div>• Read-Only Schema Introspection</div>
                <div>• Zero Direct AI Connections</div>
                <div>• Ephemeral Connection Cleanup</div>
                <div>• Parameterized INSERT & Scoped UPDATE</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works 3-Step Walkthrough */}
      <section id="how-it-works" className="py-20 bg-white border-b border-slate-200/80 px-4 sm:px-6 scroll-mt-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100">
              Simple 3-Step Setup
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mt-3 tracking-tight">
              Launch Your First Pipeline in Minutes
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-2 max-w-xl mx-auto">
              From registration to automated database publication in three clear steps.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 flex flex-col justify-between card-hover-lift">
              <div>
                <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm mb-4">
                  1
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-2">Connect Your Database</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Enter your MySQL host, port, database, and credentials. Test the connection with one click. Credentials are encrypted at rest with AES-256.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-200/60 text-[11px] text-indigo-600 font-semibold">
                Ephemeral PDO • SSRF Safe
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 flex flex-col justify-between card-hover-lift">
              <div>
                <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center font-bold text-sm mb-4">
                  2
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-2">Discover Schema & Map Fields</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Browse tables, identify foreign key relationships, attach RAG reference documents, and choose between AI-generated or manual content schedules.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-200/60 text-[11px] text-violet-600 font-semibold">
                FAISS RAG • Topological FK Sort
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 flex flex-col justify-between card-hover-lift">
              <div>
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm mb-4">
                  3
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-2">Review & Publish Safely</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Receive preview drafts via email. Approve or reject with editorial notes. At scheduled publication time, validated records are atomically committed.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-200/60 text-[11px] text-emerald-600 font-semibold">
                Signed Tokens • Rollback Guarantee
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Footer Banner */}
      <section className="py-16 px-4 sm:px-6 bg-slate-900 text-white relative overflow-hidden">
        <div className="max-w-4xl mx-auto text-center relative z-10 space-y-6">
          <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest px-3 py-1 rounded-full bg-indigo-950 border border-indigo-800">
            Self-Service Onboarding
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Ready to Automate Your Target Database?
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm max-w-xl mx-auto">
            Experience guaranteed safe relational automation with local Ollama, schema introspection, and email reviews.
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Link
              to={isAuthenticated ? "/dashboard" : "/register"}
              className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-xs shadow-md transition flex items-center gap-2"
            >
              <span>{isAuthenticated ? "Open Dashboard" : "Create Free Workspace"}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Modern SaaS Footer */}
      <footer className="border-t border-slate-200 bg-white py-8 px-4 sm:px-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center text-white font-bold text-xs">
              D
            </div>
            <span>© 2026 DataAuto. Multi-User Relational Database Automation Platform.</span>
          </div>
          <div className="flex space-x-6 font-semibold">
            {isAuthenticated ? (
              <>
                <Link to="/dashboard" className="hover:text-slate-800 transition-colors">Dashboard</Link>
                <Link to="/connections" className="hover:text-slate-800 transition-colors">Connections</Link>
                <Link to="/automations" className="hover:text-slate-800 transition-colors">Automations</Link>
                <Link to="/security" className="hover:text-slate-800 transition-colors">Security Model</Link>
              </>
            ) : (
              <>
                <Link to="/login" className="hover:text-slate-800 transition-colors">Sign In</Link>
                <Link to="/register" className="hover:text-slate-800 transition-colors">Register</Link>
                <a href="#services" className="hover:text-slate-800 transition-colors">Solutions</a>
                <a href="#security" className="hover:text-slate-800 transition-colors">Security</a>
              </>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};
