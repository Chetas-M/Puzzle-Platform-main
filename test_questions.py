import requests
import json
import time
import subprocess
import os

# Check if server is running
try:
    resp = requests.get('http://localhost:4000/api/health', timeout=2)
    print('✓ Server is running')
except:
    print('✗ Server not responding, starting fresh...')
    # Kill any existing process on port 4000
    os.system('powershell -NoProfile -Command "$conn = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue; if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }"')
    time.sleep(1)
    # Start server
    subprocess.Popen(['npm', '--prefix', 'c:\\Users\\sarth\\Desktop\\Puzzle Platform\\server', 'run', 'start'], 
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(4)

# Login test
try:
    print('\n--- Testing Question Loading System ---')
    login_resp = requests.post('http://localhost:4000/api/auth/login', 
                              json={'teamId': 'T001', 'password': 'alpha123'})
    if login_resp.status_code == 200:
        token = login_resp.json()['token']
        print('✓ Team login successful')
        
        # Get status with question
        status_resp = requests.get('http://localhost:4000/api/team/status',
                                  headers={'Authorization': f'Bearer {token}'})
        status = status_resp.json()
        
        q_text = status['puzzle']['puzzle_text']
        print(f'✓ Question loaded: "{q_text[:60]}..."')
        print(f'✓ Puzzle ID: {status["puzzle"]["puzzle_id"]}')
        print(f'✓ Submission mode: {status["puzzle"]["submission_mode"]} (should be "text")')
        print(f'✓ Asset files count: {len(status["puzzle"]["asset_files"])} (should be 0)')
        
        # Test submission with correct answer
        print('\n--- Testing Submission ---')
        # We need to find what the answer is. Let's try a known one
        # Question 1: "I speak without a mouth..." = "echo"
        
        submit_resp = requests.post('http://localhost:4000/api/team/submit',
                                   headers={'Authorization': f'Bearer {token}'},
                                   json={'answer': 'echo'})
        
        if submit_resp.status_code == 200:
            result = submit_resp.json()
            print(f'✓ Submission processed')
            print(f'  - Correct: {result.get("correct", False)}')
            print(f'  - Message: {result.get("message", "")}')
        else:
            print(f'✗ Submission failed: {submit_resp.text}')
    else:
        print(f'✗ Login failed: {login_resp.status_code} - {login_resp.text}')
except Exception as e:
    print(f'✗ Error: {e}')
    import traceback
    traceback.print_exc()
