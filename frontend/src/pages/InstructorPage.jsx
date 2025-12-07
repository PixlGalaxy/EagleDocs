import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileText, PlusCircle, BookOpenCheck, RefreshCw } from 'lucide-react';
import { apiRequest } from '../utils/api';
import { useAuth } from '../context/AuthContext';

const InstructorPage = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [courses, setCourses] = useState([]);
  const [documentsByCourse, setDocumentsByCourse] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [uploadingCourseId, setUploadingCourseId] = useState(null);
  const [newCourse, setNewCourse] = useState({
    code: '',
    name: '',
    description: '',
    academicYear: new Date().getFullYear(),
    crn: '',
  });

  const fetchCourses = async () => {
    setLoading(true);
    try {
      const data = await apiRequest('/courses?scope=mine');
      setCourses(data.courses || []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  const handleCreateCourse = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError('');

    try {
      const body = {
        code: newCourse.code,
        name: newCourse.name,
        description: newCourse.description,
        academicYear: newCourse.academicYear,
        crn: newCourse.crn,
      };
      const data = await apiRequest('/courses', { method: 'POST', body });
      setCourses((prev) => [data.course, ...prev]);
      setNewCourse({ code: '', name: '', description: '', academicYear: new Date().getFullYear(), crn: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const readFileAsBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result || '';
        const base64 = result.toString().split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Could not read the file'));
      reader.readAsDataURL(file);
    });

  const loadDocuments = async (courseId) => {
    try {
      const data = await apiRequest(`/courses/${courseId}/documents`);
      setDocumentsByCourse((prev) => ({ ...prev, [courseId]: data.documents || [] }));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleFileChange = async (courseId, event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setError('Only PDF files are allowed');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setError('Files must be under 20MB');
      return;
    }

    setUploadingCourseId(courseId);
    setError('');

    try {
      const base64 = await readFileAsBase64(file);
      await apiRequest(`/courses/${courseId}/documents`, {
        method: 'POST',
        body: { fileName: file.name, fileData: base64 },
      });
      await loadDocuments(courseId);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingCourseId(null);
      event.target.value = '';
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-white shadow-sm">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/EagleDocs Logo.png" alt="EagleDocs" className="w-10 h-10" />
            <div>
              <h1 className="text-2xl font-semibold">Instructor Dashboard</h1>
              <p className="text-sm text-gray-500">Upload PDFs and define course-scoped RAG by code</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium">{user?.email}</p>
              <p className="text-xs text-gray-500">Instructor</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-sm bg-gray-100 px-3 py-2 rounded hover:bg-gray-200"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">
        <section className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <PlusCircle className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Create course</h2>
          </div>
          <form onSubmit={handleCreateCourse} className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Course code</label>
              <input
                value={newCourse.code}
                onChange={(e) => setNewCourse((prev) => ({ ...prev, code: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="E.g., COP1234"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Name</label>
              <input
                value={newCourse.name}
                onChange={(e) => setNewCourse((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="Intro to..."
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Academic year</label>
              <input
                type="number"
                value={newCourse.academicYear}
                onChange={(e) => setNewCourse((prev) => ({ ...prev, academicYear: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="2025"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">CRN</label>
              <input
                value={newCourse.crn}
                onChange={(e) => setNewCourse((prev) => ({ ...prev, crn: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="5-digit CRN"
                required
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Description</label>
              <input
                value={newCourse.description}
                onChange={(e) => setNewCourse((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="Optional"
              />
            </div>
            <div className="md:col-span-4 flex justify-end">
              <button
                type="submit"
                disabled={creating}
                className={`px-4 py-2 text-sm text-white rounded ${
                  creating ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                {creating ? 'Creating...' : 'Create course'}
              </button>
            </div>
          </form>
        </section>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3">{error}</div>
        )}

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <BookOpenCheck className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Your courses</h2>
            <button
              onClick={fetchCourses}
              className="ml-auto inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>

          {loading ? (
            <p className="text-gray-500">Loading courses...</p>
          ) : courses.length === 0 ? (
            <p className="text-gray-500">You haven't created any courses yet.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {courses.map((course) => (
                <div key={course.id} className="bg-white rounded-lg shadow p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs uppercase text-blue-600 font-semibold">{course.code}</p>
                      <h3 className="text-lg font-semibold">{course.name}</h3>
                      {course.description && (
                        <p className="text-sm text-gray-600">{course.description}</p>
                      )}
                    </div>
                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full">
                      {course.document_count || 0} PDF
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Upload className="h-4 w-4" />
                    <label className="cursor-pointer text-blue-600 hover:text-blue-700">
                      <span>{uploadingCourseId === course.id ? 'Uploading...' : 'Upload PDF'}</span>
                      <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={(e) => handleFileChange(course.id, e)}
                        disabled={uploadingCourseId === course.id}
                      />
                    </label>
                    <button
                      onClick={() => loadDocuments(course.id)}
                      className="ml-auto text-xs text-gray-500 underline"
                    >
                      View files
                    </button>
                  </div>

                  <div className="bg-gray-50 rounded p-3 space-y-2 text-sm">
                    <p className="text-gray-700">
                      Share the code <span className="font-semibold">{course.code}</span> with your students.
                    </p>
                    <p className="text-gray-500">
                      The RAG will use every PDF uploaded for this course during chat.
                    </p>
                  </div>

                  {documentsByCourse[course.id]?.length ? (
                    <div className="border-t pt-3 space-y-2">
                      {documentsByCourse[course.id].map((doc) => (
                        <div key={doc.id} className="flex items-center gap-2 text-sm text-gray-700">
                          <FileText className="h-4 w-4 text-gray-500" />
                          <span className="truncate">{doc.original_name}</span>
                          <span className="text-xs text-gray-500">
                            {(doc.size_bytes / 1024 / 1024).toFixed(2)} MB
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default InstructorPage;
