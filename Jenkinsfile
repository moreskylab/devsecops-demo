pipeline {
  agent any
  environment {
    // Required for a Semgrep AppSec Platform-connected scan:
    SEMGREP_APP_TOKEN = credentials('SEMGREP_APP_TOKEN')
    // Set typical project (repo) name
    SEMGREP_REPO_NAME = env.GIT_URL.replaceFirst(/^https:\/\/github.com\/(.*)$/, '$1')
  }
  stages {
    stage('semgrep-scan') {
      steps {
        sh '''
          docker pull semgrep/semgrep:latest
          docker run --rm \
            -e SEMGREP_APP_TOKEN="${SEMGREP_APP_TOKEN}" \
            -e SEMGREP_REPO_NAME="${SEMGREP_REPO_NAME}" \
            -v "${WORKSPACE}:${WORKSPACE}" \
            --workdir "${WORKSPACE}" \
            semgrep/semgrep:latest semgrep ci
        '''
      }
    }
  }
}
